import crypto from 'crypto';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import { platform, tmpdir } from 'os';

function assertExecutable(path) {
  const stat = statSync(path);
  if (!stat.isFile() && !stat.isSymbolicLink()) {
    throw new Error(`Camoufox executable is not a file: ${path}`);
  }
  if (platform() !== 'win32') accessSync(path, constants.X_OK);
}

function nixStoreRoot(path) {
  const match = path.match(/^\/nix\/store\/[^/]+/);
  return match?.[0] || null;
}

function collectDirs(root, maxDepth = 4) {
  const dirs = [];
  const queue = [{ dir: root, depth: 0 }];
  const seen = new Set();

  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (seen.has(dir)) continue;
    seen.add(dir);
    dirs.push(dir);
    if (depth >= maxDepth) continue;

    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      queue.push({ dir: join(dir, entry.name), depth: depth + 1 });
    }
  }

  return dirs;
}

function findResourceDir(executablePath) {
  const resolvedPath = realpathSync(executablePath);
  const directDirs = [
    dirname(executablePath),
    dirname(resolvedPath),
  ];
  const macAppResources = platform() === 'darwin'
    ? [
        join(dirname(dirname(executablePath)), 'Resources'),
        join(dirname(dirname(resolvedPath)), 'Resources'),
      ]
    : [];

  const storeRoot = nixStoreRoot(resolvedPath) || nixStoreRoot(executablePath);
  const likelyDirs = storeRoot
    ? [
        storeRoot,
        join(storeRoot, 'lib', 'camoufox'),
        join(storeRoot, 'libexec', 'camoufox'),
        join(storeRoot, 'share', 'camoufox'),
        join(storeRoot, 'opt', 'camoufox'),
      ]
    : [];

  const allCandidates = [...directDirs, ...macAppResources, ...likelyDirs];
  for (const dir of allCandidates) {
    if (existsSync(join(dir, 'properties.json'))) return dir;
  }

  if (storeRoot) {
    for (const dir of collectDirs(storeRoot)) {
      if (existsSync(join(dir, 'properties.json'))) return dir;
    }
  }

  return null;
}

function ensureSymlink(target, linkPath, type = 'file') {
  rmSync(linkPath, { force: true, recursive: true });
  symlinkSync(target, linkPath, platform() === 'win32' && type === 'dir' ? 'junction' : type);
}

function shimRootFor(executablePath, resourceDir) {
  const key = crypto
    .createHash('sha256')
    .update(`${realpathSync(executablePath)}\n${realpathSync(resourceDir)}`)
    .digest('hex')
    .slice(0, 16);
  return join(tmpdir(), 'camofox-browser-external-camoufox', key);
}

function isMacAppExecutable(executablePath) {
  return platform() === 'darwin' && /\.app\/Contents\/MacOS\/[^/]+$/.test(executablePath);
}

function ensureLaunchShim(executablePath, resourceDir) {
  // A macOS app executable resolves XPCOM and dylibs relative to its .app
  // bundle. Launching it through a flattened compatibility shim breaks that
  // lookup, so retain the original immutable bundle path.
  if (isMacAppExecutable(executablePath)) return executablePath;

  const shimRoot = shimRootFor(executablePath, resourceDir);
  mkdirSync(shimRoot, { recursive: true });

  const shimExecutable = join(shimRoot, platform() === 'win32' ? 'camoufox.exe' : 'camoufox-bin');
  ensureSymlink(realpathSync(executablePath), shimExecutable);

  for (const name of ['properties.json', 'version.json', 'application.ini']) {
    const target = join(resourceDir, name);
    if (existsSync(target)) ensureSymlink(realpathSync(target), join(shimRoot, name));
  }

  // Official 0.5 resolves font groups and bundled addons beside executable_path,
  // not through the former flat cache. Preserve that complete sibling layout.
  for (const name of ['fontconfig', 'fonts', 'addons']) {
    const target = join(resourceDir, name);
    if (existsSync(target)) ensureSymlink(realpathSync(target), join(shimRoot, name), 'dir');
  }

  return shimExecutable;
}

export function prepareExternalCamoufoxExecutable(executablePath) {
  if (!executablePath) return null;

  const resolvedExecutable = resolve(executablePath);
  assertExecutable(resolvedExecutable);

  const resourceDir = findResourceDir(resolvedExecutable);
  if (!resourceDir) {
    throw new Error(
      `Could not find Camoufox resources for ${resolvedExecutable}. ` +
      'Point the executable override at a Camoufox bundle that includes properties.json.'
    );
  }


  return {
    executablePath: ensureLaunchShim(resolvedExecutable, resourceDir),
    resourceDir,
  };
}
