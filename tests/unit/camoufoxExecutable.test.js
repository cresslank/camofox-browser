import { afterEach, describe, expect, test } from '@jest/globals';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { getEnvVars } from 'camoufox/dist/utils.js';
import { addDefaultAddons } from 'camoufox/dist/addons.js';
import { dirname, join } from 'path';
import { platform, tmpdir } from 'os';
import { prepareExternalCamoufoxExecutable } from '../../lib/camoufox-executable.js';

const tempDirs = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'camofox-executable-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(join(tmpdir(), 'camofox-browser-external-camoufox'), { recursive: true, force: true });
});

describe('prepareExternalCamoufoxExecutable', () => {
  test('prepares an external bundle without polluting the browser cache', () => {
    const bundleDir = makeTempDir();
    const cacheDir = makeTempDir();
    const executable = join(bundleDir, 'camoufox-bin');

    writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    chmodSync(executable, 0o755);
    writeFileSync(join(bundleDir, 'properties.json'), '[]\n');
    writeFileSync(join(bundleDir, 'application.ini'), '[App]\nVersion=158.0.1\n');
    writeFileSync(join(bundleDir, 'version.json'), '{"version":"135.0.1","release":"beta.24"}\n');
    mkdirSync(join(bundleDir, 'fontconfig', 'lin'), { recursive: true });

    const prepared = prepareExternalCamoufoxExecutable(executable, { cacheDir });

    expect(prepared.resourceDir).toBe(bundleDir);
    expect(prepared.executablePath).toContain('camofox-browser-external-camoufox');
    expect(existsSync(prepared.executablePath)).toBe(true);
    expect(existsSync(join(dirname(prepared.executablePath), 'application.ini'))).toBe(true);
    expect(existsSync(join(cacheDir, 'version.json'))).toBe(false);
    expect(existsSync(join(cacheDir, 'fontconfig'))).toBe(false);
    expect(existsSync(join(cacheDir, 'properties.json'))).toBe(false);
    const cacheExecutable = platform() === 'darwin'
      ? join(cacheDir, 'Camoufox.app', 'Contents', 'MacOS', 'camoufox')
      : join(cacheDir, platform() === 'win32' ? 'camoufox.exe' : 'camoufox-bin');
    expect(existsSync(cacheExecutable)).toBe(false);
  });

  test('official helpers resolve external fonts and UBO through the prepared path', () => {
    if (platform() !== 'linux') return;
    const bundle = makeTempDir();
    const executable = join(bundle, 'camoufox-bin');
    writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    chmodSync(executable, 0o755);
    writeFileSync(join(bundle, 'properties.json'), '[]');
    writeFileSync(join(bundle, 'application.ini'), '[App]\nVersion=158.0.1\n');
    mkdirSync(join(bundle, 'fontconfig', 'linux'), { recursive: true });
    mkdirSync(join(bundle, 'fonts', 'L'), { recursive: true });
    mkdirSync(join(bundle, 'addons', 'UBO'), { recursive: true });
    writeFileSync(join(bundle, 'addons', 'UBO', 'manifest.json'), '{"manifest_version":2,"name":"fixture","version":"1"}');
    writeFileSync(join(bundle, 'fontconfig', 'linux', 'fonts.conf'), '<fontconfig><dir prefix="cwd">fonts</dir></fontconfig>');
    writeFileSync(join(bundle, 'fonts', 'groups.json'), '{"readBy":{"lin":["L"]}}');
    const prepared = prepareExternalCamoufoxExecutable(executable);
    const env = getEnvVars({}, 'lin', prepared.executablePath);
    const fonts = readFileSync(env.FONTCONFIG_FILE, 'utf8');
    expect(fonts).toContain(join(dirname(prepared.executablePath), 'fonts', 'L'));
    expect(existsSync(join(dirname(prepared.executablePath), 'fonts', 'L'))).toBe(true);
    const addons = [];
    addDefaultAddons(addons, undefined, prepared.executablePath);
    expect(addons).toEqual([join(dirname(prepared.executablePath), 'addons', 'UBO')]);
  });

  test('preserves a macOS app bundle executable instead of flattening it', () => {
    if (platform() !== 'darwin') return;
    const root = makeTempDir();
    const cacheDir = makeTempDir();
    const contents = join(root, 'Camoufox.app', 'Contents');
    const executable = join(contents, 'MacOS', 'camoufox');
    mkdirSync(dirname(executable), { recursive: true });
    mkdirSync(join(contents, 'Resources'), { recursive: true });
    writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    chmodSync(executable, 0o755);
    writeFileSync(join(root, 'version.json'), '{"version":"test"}\n');
    writeFileSync(join(contents, 'Resources', 'properties.json'), '[]\n');

    const prepared = prepareExternalCamoufoxExecutable(executable, { cacheDir });

    expect(prepared.resourceDir).toBe(join(contents, 'Resources'));
    expect(prepared.executablePath).toBe(executable);
    expect(existsSync(join(cacheDir, 'version.json'))).toBe(false);
    expect(existsSync(join(dirname(executable), 'properties.json'))).toBe(false);
  });

  test('fails clearly when bundle resources are missing', () => {
    const bundleDir = makeTempDir();
    const executable = join(bundleDir, 'camoufox-bin');
    writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    chmodSync(executable, 0o755);

    expect(() => prepareExternalCamoufoxExecutable(executable, { cacheDir: makeTempDir() }))
      .toThrow(/properties\.json/);
  });
});
