import { describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BUNDLED_CAMOUFOX_RELEASE, assertCompatibleCamoufoxCache, downloadBundledCamoufox } from '../../lib/camoufox-download.js';
import { main } from '../../postinstall.js';

function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'camofox-cache-test-'));
  return Promise.resolve().then(() => fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

describe('official Camoufox pairing and cache safety', () => {
  test('matches the exact official package browser pin', () => {
    const pin = JSON.parse(readFileSync(new URL('../../node_modules/camoufox/dist/data-files/browser-pin.json', import.meta.url)));
    expect(pin).toMatchObject({ repo: 'daijro/camoufox', tag: `v${BUNDLED_CAMOUFOX_RELEASE}` });
  });
  test('refuses legacy metadata without spawning a destructive fetch', () => fixture(async dir => {
    const version = '{"version":"152.0.4","release":"beta.30"}';
    writeFileSync(join(dir, 'version.json'), version);
    const run = jest.fn();
    await expect(downloadBundledCamoufox({ run, cacheDir: dir })).rejects.toThrow(/Legacy Camoufox cache/);
    expect(run).not.toHaveBeenCalled();
    expect(readFileSync(join(dir, 'version.json'), 'utf8')).toBe(version);
  }));
  test('missing model and browser fail without a network fetch or cache mutation', () => fixture(dir => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { assertBundledCamoufoxInstalled, assertCamoufoxModelInstalled } from './lib/camoufox-download.js';
      globalThis.fetch = () => { throw new Error('unexpected network fetch'); };
      for (const check of [assertBundledCamoufoxInstalled, assertCamoufoxModelInstalled]) {
        try { check(); process.exit(1); } catch (error) {
          if (!/is not installed/.test(error.message)) throw error;
        }
      }
    `], { cwd: process.cwd(), encoding: 'utf8', env: {
      ...process.env, HOME: dir, XDG_CACHE_HOME: join(dir, 'cache'),
      CAMOUFOX_FPGEN_DATA: join(dir, 'missing-model'),
    } });
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  }));
  test('accepts an official cache marker', () => fixture(dir => {
    writeFileSync(join(dir, '.0.5_FLAG'), '');
    expect(() => assertCompatibleCamoufoxCache(dir)).not.toThrow();
  }));
  test('postinstall verifies after fetching rather than trusting a stale sentinel', async () => {
    const download = jest.fn().mockResolvedValue(undefined);
    const verify = jest.fn();
    const previous = process.env.CAMOFOX_SKIP_DOWNLOAD;
    delete process.env.CAMOFOX_SKIP_DOWNLOAD;
    try { await main({ download, verify }); } finally {
      if (previous !== undefined) process.env.CAMOFOX_SKIP_DOWNLOAD = previous;
    }
    expect(download).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(1);
  });
});
