// Explicit native gate: CAMOFOX_STORAGE_TEST_EXECUTABLE=<qualified browser> node --test scripts/test-storage-restore.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Camoufox } from 'camoufox';
import { newContextWithStorage } from '../lib/storage-restore.js';

const executable_path = process.env.CAMOFOX_STORAGE_TEST_EXECUTABLE;
assert.ok(executable_path, 'set CAMOFOX_STORAGE_TEST_EXECUTABLE to an isolated, qualified browser');
const item = { name: 'synthetic-key', value: 'synthetic-value' };
const state = {
  cookies: [{ name: 'synthetic-cookie', value: 'preserved', domain: 'storage-0.example.test', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }],
  origins: Array.from({ length: 24 }, (_, n) => ({ origin: `https://storage-${n}.example.test`, localStorage: [item] })),
};
state.origins.push({ origin: 'https://tr.snapchat.com', localStorage: [item] });

test('blocked origin does not discard healthy origins or cookies; unknown failures preserve state', async () => {
  const browser = await Camoufox({ executable_path, headless: true, geoip: false, humanize: false });
  let context;
  try {
    // Exercise the real native failure first. Enough offline navigations allow
    // the bundled extension to finish initializing before its blocked domain.
    await assert.rejects(browser.newContext({ storageState: state }), /NS_ERROR_ABORT|NS_BINDING_ABORTED/);
    const reports = [];
    const started = Date.now();
    context = await newContextWithStorage(browser, { storageState: structuredClone(state), locale: 'en-US' }, (...args) => reports.push(args));
    assert.ok(Date.now() - started < 30000, 'restore must fit the controller create deadline');
    assert.deepEqual(reports, [['info', 'persisted origins restored', { restored: 24, skipped_navigation_aborted: 1 }]]);
    assert.equal((await context.cookies()).find(c => c.name === 'synthetic-cookie')?.value, 'preserved');
    const page = await context.newPage();
    await page.route('**/*', route => route.fulfill({ body: '<html><h1>fixture</h1></html>', contentType: 'text/html' }));
    for (const { origin } of state.origins.slice(0, 24)) {
      await page.goto(origin);
      assert.equal(await page.evaluate(() => localStorage.getItem('synthetic-key')), 'synthetic-value');
    }
    assert.equal(await page.evaluate(() => navigator.language), 'en-US');
    const exported = await context.storageState();
    assert.equal(exported.origins.length, 24, 'healthy origins survive a real checkpoint');
    await context.close(); context = undefined;
    const tooLarge = { cookies: [], origins: [{ origin: 'https://quota.example.test', localStorage: [{ name: 'oversized', value: 'x'.repeat(6 * 1024 * 1024) }] }] };
    await assert.rejects(newContextWithStorage(browser, { storageState: tooLarge }), error => error.preserveStorageState === true && /quota/i.test(error.message));
    assert.equal(browser.contexts().length, 0, 'all failed/temporary contexts are closed');
  } finally {
    await context?.close();
    await browser.close();
  }
});
