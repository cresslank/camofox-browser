import { afterEach, describe, expect, test } from '@jest/globals';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const children = new Set();

function makeDisposableState() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'camofox-warm-race-'));
  const dirs = {};
  for (const name of ['home', 'hermes', 'tmp', 'cache', 'config', 'data', 'state', 'cookies', 'uploads', 'profiles', 'traces']) {
    dirs[name] = path.join(root, name);
    fs.mkdirSync(dirs[name], { recursive: true });
  }
  return { root, dirs, eventsPath: path.join(root, 'launch-events.jsonl') };
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const { port } = socket.address();
      socket.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function readEvents(eventsPath) {
  if (!fs.existsSync(eventsPath)) return [];
  return fs.readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

async function waitFor(predicate, description, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${description}`);
}

function waitForExit(child, timeoutMs = 5000) {
  return Promise.race([
    new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => setTimeout(() => reject(new Error('server did not exit')), timeoutMs)),
  ]);
}

async function startRaceServer() {
  const state = makeDisposableState();
  const port = await freePort();
  const output = [];
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    HOME: state.dirs.home,
    HERMES_HOME: state.dirs.hermes,
    TMPDIR: state.dirs.tmp,
    XDG_CACHE_HOME: state.dirs.cache,
    XDG_CONFIG_HOME: state.dirs.config,
    XDG_DATA_HOME: state.dirs.data,
    XDG_STATE_HOME: state.dirs.state,
    CAMOFOX_COOKIES_DIR: state.dirs.cookies,
    CAMOFOX_UPLOADS_DIR: state.dirs.uploads,
    CAMOFOX_PROFILE_DIR: state.dirs.profiles,
    CAMOFOX_TRACES_DIR: state.dirs.traces,
    CAMOFOX_BIND_HOST: '127.0.0.1',
    CAMOFOX_PORT: String(port),
    CAMOFOX_ADMIN_KEY: 'race-admin-key',
    CAMOFOX_CRASH_REPORT_ENABLED: 'false',
    BROWSER_IDLE_TIMEOUT_MS: '0',
    CAMOFOX_TEST_LAUNCH_EVENTS_PATH: state.eventsPath,
    CAMOFOX_TEST_LAUNCH_DELAYS_MS: '80,300',
    CAMOFOX_TEST_LAUNCH_TIMEOUT_MS: '20',
    CAMOFOX_TEST_WARM_RETRY_DELAY_MS: '15',
  };
  const child = spawn(process.execPath, ['server.js'], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));
  child.once('exit', () => children.delete(child));

  await waitFor(
    () => readEvents(state.eventsPath).some(event => event.event === 'launch-start' && event.call === 2),
    'the actual background warm retry to enter its delayed launch',
  );
  return { child, state, port, output };
}

afterEach(async () => {
  for (const child of children) {
    child.kill('SIGKILL');
    await waitForExit(child).catch(() => {});
  }
  children.clear();
});

function expectBothCandidatesClosed(events) {
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({ event: 'launch-start', call: 1, delayMs: 80 }),
    expect.objectContaining({ event: 'browser-close', call: 1 }),
    expect.objectContaining({ event: 'launch-start', call: 2, delayMs: 300 }),
    expect.objectContaining({ event: 'browser-close', call: 2 }),
  ]));
  expect(events.filter(event => event.event === 'launch-start' && event.call > 2)).toEqual([]);
}

describe('process-level warm retry cancellation races', () => {
  test('POST /stop cancels an already-started warm-retry launch and waits for candidate cleanup', async () => {
    const { child, state, port, output } = await startRaceServer();

    const response = await fetch(`http://127.0.0.1:${port}/stop`, {
      method: 'POST',
      headers: { 'x-admin-key': 'race-admin-key' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, stopped: true });

    // A timed-out warm-retry promise used to defer a third launch after /stop.
    // Wait beyond the retry delay to prove the administrative fence remains final.
    await new Promise(resolve => setTimeout(resolve, 75));
    const stopEvents = readEvents(state.eventsPath);
    if (stopEvents.some(event => event.event === 'launch-start' && event.call > 2)) {
      throw new Error(`unexpected post-stop launch: ${JSON.stringify(stopEvents)}\n${output.join('')}`);
    }
    expectBothCandidatesClosed(stopEvents);
    expect(output.join('')).toContain('background browser warm retry cancelled');

    child.kill('SIGTERM');
    await expect(waitForExit(child)).resolves.toMatchObject({ code: 0, signal: null });
    fs.rmSync(state.root, { recursive: true, force: true });
  }, 10000);

  test('SIGTERM shutdown cancels an already-started warm-retry launch and exits only after cleanup', async () => {
    const { child, state, output } = await startRaceServer();

    child.kill('SIGTERM');
    await expect(waitForExit(child)).resolves.toMatchObject({ code: 0, signal: null });

    expectBothCandidatesClosed(readEvents(state.eventsPath));
    const logs = output.join('');
    expect(logs).toContain('shutting down');
    expect(logs).toContain('background browser warm retry cancelled');
    fs.rmSync(state.root, { recursive: true, force: true });
  }, 10000);
});
