import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getUserPersistencePaths } from '../../lib/persistence.js';
import { loadConfig } from '../../lib/config.js';

// Fault injection is a real persisted IndexedDB entry rejected by the real
// browser, not a mock of newContext or the persistence lifecycle.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let root, profiles, fixture, child, base, origin;
let output = '';

async function request(method, route, body, timeout = 45000) {
  const response = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json();
  expect({ status: response.status, data }).toMatchObject({ status: 200 });
  return data;
}

async function seed(userId, state) {
  const paths = getUserPersistencePaths(profiles, userId);
  await fs.mkdir(paths.userDir, { recursive: true, mode: 0o755 });
  await fs.writeFile(paths.storageStatePath, JSON.stringify(state), { mode: 0o644 });
  await fs.writeFile(paths.metaPath, '{}', { mode: 0o644 });
  return paths;
}

async function readBrowserState(userId, tabId) {
  const { result } = await request('POST', `/tabs/${tabId}/evaluate`, {
    userId,
    expression: '({ cookie: document.cookie, saved: localStorage.getItem("saved") })',
  });
  return result;
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'camofox-restore-'));
  profiles = path.join(root, 'profiles');
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  const cfg = loadConfig();
  if (!cfg.camoufoxExecutablePath) {
    const cache = process.platform === 'darwin'
      ? path.join(home, 'Library', 'Caches', 'camoufox')
      : path.join(home, '.cache', 'camoufox');
    await fs.cp(cfg.camoufoxCacheDir, cache, { recursive: true, mode: constants.COPYFILE_FICLONE });
  }
  fixture = http.createServer((req, res) => res.end('<h1>Persistence fixture</h1>'));
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  origin = `http://127.0.0.1:${fixture.address().port}`;
  const reservation = http.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  base = `http://127.0.0.1:${port}`;
  // Match a constrained deployment without changing clocks, restoration or the
  // production 30-second tab deadline.
  const cpu = process.platform === 'linux'
    ? (await fs.readFile('/proc/self/status', 'utf8')).match(/Cpus_allowed_list:\s*(\d+)/)?.[1]
    : null;
  child = spawn(cpu ? 'taskset' : process.execPath, cpu
    ? ['-c', cpu, process.execPath, 'server.js'] : ['server.js'], {
    cwd: repo,
    env: {
      ...process.env,
      HOME: home, HERMES_HOME: path.join(root, 'hermes'),
      XDG_CACHE_HOME: path.join(home, '.cache'), TMPDIR: root,
      CAMOFOX_PORT: String(port), CAMOFOX_BIND_HOST: '127.0.0.1',
      CAMOFOX_PROFILE_DIR: profiles, CAMOFOX_COOKIES_DIR: path.join(root, 'cookies'),
      CAMOFOX_UPLOADS_DIR: path.join(root, 'uploads'), CAMOFOX_TRACES_DIR: path.join(root, 'traces'),
      CAMOFOX_CRASH_REPORT_ENABLED: 'false', NODE_ENV: 'test',
      BROWSER_PSS_RESTART_THRESHOLD_MB: '8192',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + '/health', { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    if (child.exitCode !== null) throw new Error(`server exited: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`server did not become ready: ${output}`);
}, 60000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    await exited;
    clearTimeout(timer);
  }
  if (fixture) await new Promise(resolve => fixture.close(resolve));
  if (root) await fs.rm(root, { recursive: true, force: true });
}, 15000);

describe('real HTTP persisted-profile recovery', () => {
  test('valid profiles still restore and legacy permissions become private', async () => {
    const userId = 'healthy-profile';
    const paths = await seed(userId, {
      cookies: [{ name: 'sid', value: 'healthy', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }],
      origins: [{ origin, localStorage: [{ name: 'saved', value: 'healthy' }] }],
    });
    const { tabId } = await request('POST', '/tabs', { userId, sessionKey: 'test', url: origin });
    expect(await readBrowserState(userId, tabId)).toEqual({ cookie: 'sid=healthy', saved: 'healthy' });
    for (const dir of [profiles, paths.userDir]) expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
    for (const file of [paths.storageStatePath, paths.metaPath]) expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });

  test('393 retained origins prepare before the tab deadline and checkpoint losslessly', async () => {
    const userId = 'large-retained-profile';
    const state = {
      cookies: Array.from({ length: 3925 }, (_, i) => ({
        name: `cookie-${i}`, value: `fixture-${i}`, domain: `restore-${i % 392}.invalid`,
        path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax',
      })),
      origins: Array.from({ length: 393 }, (_, i) => ({
        origin: i === 0 ? origin : `http://restore-${i}.invalid`,
        localStorage: Array.from({ length: 3 }, (_, j) => ({
          name: `saved-${j}`, value: `${i}-${j}:` + 'x'.repeat(2048),
        })),
      })),
    };
    const paths = await seed(userId, state);
    const before = output.length;
    const pending = request('POST', '/tabs', { userId, sessionKey: 'retained', url: origin }, 180000);
    const deadline = Date.now() + 30000;
    while (!output.slice(before).includes('restoring persisted storage state')) {
      if (Date.now() > deadline) throw new Error('restoration did not start');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    // Health remains responsive during the separate preparation phase, so
    // listener/readiness probes need not wait for every persisted origin.
    expect((await fetch(base + '/health', { signal: AbortSignal.timeout(5000) })).status).toBe(200);
    const created = await pending;
    expect(created.tabId).toEqual(expect.any(String));
    expect(output.slice(before)).toContain('"restored":393');
    expect(output.slice(before)).not.toContain('tab create timed out');
    await request('DELETE', `/sessions/${userId}`, undefined, 180000);
    const saved = JSON.parse(await fs.readFile(paths.storageStatePath, 'utf8'));
    const ordered = data => ({
      cookies: [...data.cookies].sort((a, b) => a.name.localeCompare(b.name)),
      origins: [...data.origins].map(entry => ({
        ...entry, localStorage: [...entry.localStorage].sort((a, b) => a.name.localeCompare(b.name)),
      })).sort((a, b) => a.origin.localeCompare(b.origin)),
    });
    expect(ordered(saved)).toEqual(ordered(state));
  }, 300000);

  test('IndexedDB restore failure serves a clean request, drops only the rejected snapshot and recovers durably', async () => {
    const userId = 'broken-profile';
    const healthyPaths = await seed('untouched-profile', { cookies: [], origins: [] });
    const healthyBytes = await fs.readFile(healthyPaths.storageStatePath, 'utf8');
    const paths = await seed(userId, {
      cookies: [{ name: 'sid', value: 'must-not-survive', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }],
      origins: [{ origin, localStorage: [{ name: 'saved', value: 'must-not-survive' }], indexedDB: [{ name: 'invalid-version', version: 0, stores: [] }] }],
    });
    const { tabId } = await request('POST', '/tabs', { userId, sessionKey: 'test', url: origin });
    expect(await readBrowserState(userId, tabId)).toEqual({ cookie: '', saved: null });
    expect(output).toContain('indexeddb_restore_failed');
    expect(output).toContain('discarded unrestorable persisted storage state');
    expect(output).not.toContain('must-not-survive');
    await expect(fs.access(paths.storageStatePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(paths.metaPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(healthyPaths.storageStatePath, 'utf8')).toBe(healthyBytes);

    // Normal checkpoints resume; the next session restores the new clean state
    // rather than repeatedly hitting the rejected IndexedDB entry.
    await request('DELETE', `/sessions/${userId}`);
    const saved = JSON.parse(await fs.readFile(paths.storageStatePath, 'utf8'));
    expect(saved.cookies).toEqual([]);
    expect(JSON.stringify(saved)).not.toContain('invalid-version');
    for (const file of [paths.storageStatePath, paths.metaPath]) expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    const next = await request('POST', '/tabs', { userId, sessionKey: 'next', url: origin });
    expect(await readBrowserState(userId, next.tabId)).toEqual({ cookie: '', saved: null });
    expect(output.match(/storage state restore failed; using clean context/g)).toHaveLength(1);
    expect((await fs.readdir(paths.userDir)).filter(name => name.includes('.tmp-'))).toEqual([]);
  });
});
