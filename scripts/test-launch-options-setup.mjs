import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const repo = fileURLToPath(new URL('../', import.meta.url));
const executable = process.env.CAMOFOX_STORAGE_TEST_EXECUTABLE;

test('cold native GPU setup over ten seconds still serves create, snapshot and close', {
  skip: !executable && 'set CAMOFOX_STORAGE_TEST_EXECUTABLE to a qualified official browser',
  timeout: 90000,
}, async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'camofox-launch-options-'));
  const fixture = http.createServer((_req, res) => res.end('<html><body><h1>Cold launch fixture</h1></body></html>'));
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const listener = http.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const preload = path.join(scratch, 'slow-gpu.mjs');
  const utils = pathToFileURL(path.join(repo, 'node_modules/camoufox/dist/utils.js')).href;
  await fs.writeFile(preload, `
    const { utilsDeps } = await import(${JSON.stringify(utils)});
    const real = utilsDeps.hostGpu;
    utilsDeps.hostGpu = async (...args) => {
      console.log('TEST_GPU_PROBE_BEGIN');
      await new Promise(resolve => setTimeout(resolve, 11000));
      const result = await real(...args);
      console.log('TEST_GPU_PROBE_END');
      return result;
    };
    utilsDeps.publicIp = async () => { throw new Error('unexpected public-IP lookup'); };
    utilsDeps.getGeolocation = async () => { throw new Error('unexpected GeoIP database lookup'); };
  `);
  const profiles = path.join(scratch, 'profiles');
  if (process.env.CAMOFOX_LAUNCH_TEST_PROFILE) {
    await fs.mkdir(path.join(profiles, '3dcc048b8a1366ae138be614acba9337'), {recursive: true});
    await fs.copyFile(process.env.CAMOFOX_LAUNCH_TEST_PROFILE,
      path.join(profiles, '3dcc048b8a1366ae138be614acba9337', 'storage-state.json'));
  }
  const child = spawn(process.execPath, ['--import', preload, path.join(repo, 'server.js')], {
    cwd: repo,
    env: { ...process.env, NODE_ENV: 'test', CAMOFOX_PORT: String(port), CAMOFOX_BIND_HOST: '127.0.0.1',
      CAMOFOX_EXECUTABLE_PATH: executable, CAMOFOX_PROFILE_DIR: profiles,
      CAMOFOX_COOKIES_DIR: path.join(scratch, 'cookies'), CAMOFOX_UPLOADS_DIR: path.join(scratch, 'uploads'),
      CAMOFOX_TRACES_DIR: path.join(scratch, 'traces'), CAMOFOX_INTERACTIVE: 'off',
      PROXY_HOST: '', PROXY_BACKCONNECT_HOST: '', CAMOFOX_API_KEY: '', CAMOFOX_ACCESS_KEY: '',
      SESSION_TIMEOUT_MS: '0', BROWSER_IDLE_TIMEOUT_MS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const base = `http://127.0.0.1:${port}`;
  const api = async (url, options) => {
    const response = await fetch(base + url, { ...options, signal: AbortSignal.timeout(60000) });
    const data = await response.json();
    assert.equal(response.ok, true, JSON.stringify(data));
    return data;
  };
  try {
    const deadline = Date.now() + 15000;
    while (!output.includes('TEST_GPU_PROBE_BEGIN') && Date.now() < deadline && child.exitCode === null) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(output.includes('TEST_GPU_PROBE_BEGIN'), 'real host GPU probe must run');
    const query = '?userId=firecrawl-camofox';
    const tab = await api('/tabs', { method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({userId: 'firecrawl-camofox', sessionKey: 'cold-launch-regression',
        url: `http://127.0.0.1:${fixture.address().port}/`}) });
    const snapshot = await api(`/tabs/${tab.tabId}/snapshot${query}`);
    assert.match(snapshot.snapshot, /Cold launch fixture/);
    await api(`/tabs/${tab.tabId}${query}`, {method: 'DELETE'});
    assert.ok(output.includes('TEST_GPU_PROBE_END'));
    assert.doesNotMatch(output, /unexpected public-IP|unexpected GeoIP database|setup timed out/);
    const restores = output.split('\n').filter(line => line.includes('persisted origins restored'));
    console.log(JSON.stringify({nativeColdSetup: 'passed', restored: restores.map(line => JSON.parse(line))}));
  } finally {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    await once(child, 'close');
    clearTimeout(timer);
    await new Promise(resolve => fixture.close(resolve));
    await fs.rm(scratch, {recursive: true, force: true});
  }
});
