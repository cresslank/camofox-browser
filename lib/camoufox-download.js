import { INSTALL_DIR, installedVerStr } from 'camoufox';
import { MODEL_PIN, modelDir } from 'fpgen-js';
import { camoufoxPath } from 'camoufox/dist/pkgman.js';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

// camoufox@0.5.9 carries this pairing in data-files/browser-pin.json.
export const BUNDLED_CAMOUFOX_RELEASE = '158.0.1-beta.41';
export const camoufoxCli = join(dirname(fileURLToPath(import.meta.resolve('camoufox'))), '__main__.js');

// Official 0.5 deletes incompatible legacy caches during fetch/path resolution.
// Refuse instead: an install hook must never destroy an existing service cache.
export function assertCompatibleCamoufoxCache(cacheDir = INSTALL_DIR) {
  if (existsSync(cacheDir) && readdirSync(cacheDir).length && !existsSync(join(cacheDir, '.0.5_FLAG'))) {
    throw new Error(`Legacy Camoufox cache at ${cacheDir}; choose a separate cache before fetching official Camoufox. The existing cache was not modified.`);
  }
}

export function assertCamoufoxModelInstalled() {
  // fpgen's public API exposes its pin and directory, not its offline checker.
  // Match its stamp/member check without calling ensureModel (which downloads).
  let installed = false;
  try {
    const dir = modelDir();
    installed = readFileSync(join(dir, '.pinned-model'), 'utf8').trim() === MODEL_PIN.sha256
      && MODEL_PIN.files.every(file => existsSync(join(dir, file)));
  } catch { /* missing or unreadable model */ }
  if (!installed) {
    throw new Error('Camoufox fingerprint model is not installed; run npm run fetch-bin before starting the server.');
  }
}

export function assertBundledCamoufoxInstalled() {
  assertCompatibleCamoufoxCache();
  // Only call this mutating upstream resolver after excluding legacy caches.
  const path = camoufoxPath();
  if (installedVerStr(path) !== BUNDLED_CAMOUFOX_RELEASE) {
    throw new Error(`Expected Camoufox ${BUNDLED_CAMOUFOX_RELEASE}; run npm run fetch-bin or configure an external executable.`);
  }
  return path;
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [camoufoxCli, ...args], { stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`camoufox ${args.join(' ')} failed (${signal || code})`)));
  });
}

export async function downloadBundledCamoufox({ run = runCli, cacheDir = INSTALL_DIR } = {}) {
  assertCompatibleCamoufoxCache(cacheDir);
  // Mark only a new/compatible cache before set writes config.json. This lets
  // a failed first fetch be retried without treating its own files as legacy.
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, '.0.5_FLAG'), '');
  // Discard an explicit user channel/pin in favor of the package's release pin.
  // fetch also prefetches GeoIP and the pinned fingerprint model.
  await run(['set', '--release']);
  await run(['fetch']);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  downloadBundledCamoufox().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
