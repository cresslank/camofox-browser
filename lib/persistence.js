import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function getUserPersistencePaths(profileDir, userId) {
  const rootDir = path.resolve(profileDir);
  const safeUserDir = crypto
    .createHash('sha256')
    .update(String(userId))
    .digest('hex')
    .slice(0, 32);

  const userDir = path.join(rootDir, safeUserDir);
  return {
    rootDir,
    userDir,
    storageStatePath: path.join(userDir, 'storage-state.json'),
    metaPath: path.join(userDir, 'meta.json'),
  };
}

async function privateDirectory(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid())) {
    throw new Error('unsafe persistence directory');
  }
  await fs.chmod(dir, 0o700);
}

async function privateFile(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || (process.getuid && stat.uid !== process.getuid())) {
    throw new Error('unsafe persistence file');
  }
  await fs.chmod(file, 0o600);
}

async function loadPersistedStorageState(profileDir, userId, logger = console) {
  if (!profileDir) return undefined;

  const { rootDir, userDir, storageStatePath, metaPath } = getUserPersistencePaths(profileDir, userId);

  try {
    await privateDirectory(rootDir);
    await privateDirectory(userDir);
    await privateFile(storageStatePath);
    await privateFile(metaPath).catch(err => { if (err.code !== 'ENOENT') throw err; });
    const raw = await fs.readFile(storageStatePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    if (!Array.isArray(parsed.cookies)) return undefined;
    if (parsed.origins !== undefined && !Array.isArray(parsed.origins)) return undefined;
    return storageStatePath;
  } catch (err) {
    if (err?.code === 'ENOENT') return undefined;
    logger?.warn?.('failed to load persisted storage state', {
      userId: String(userId),
      storageStatePath,
      error: err?.message || String(err),
    });
    return undefined;
  }
}

async function persistStorageState({
  profileDir,
  userId,
  context,
  storageState,
  logger = console,
  indexedDB = false,
}) {
  if (!profileDir || (!context && !storageState)) {
    return { persisted: false, reason: 'disabled' };
  }

  const { rootDir, userDir, storageStatePath, metaPath } = getUserPersistencePaths(profileDir, userId);
  const suffix = `.tmp-${process.pid}-${Date.now()}`;
  const tmpStoragePath = `${storageStatePath}${suffix}`;
  const tmpMetaPath = `${metaPath}${suffix}`;

  try {
    await privateDirectory(rootDir);
    await privateDirectory(userDir);
    // Pre-create before Playwright writes so even temporary snapshots are private.
    await fs.writeFile(tmpStoragePath, '', { mode: 0o600, flag: 'wx' });
    if (storageState) {
      await fs.writeFile(tmpStoragePath, JSON.stringify(storageState, null, 2));
    } else {
      await context.storageState(indexedDB ? { path: tmpStoragePath, indexedDB: true } : { path: tmpStoragePath });
    }
    await fs.rename(tmpStoragePath, storageStatePath);
    await fs.writeFile(
      tmpMetaPath,
      JSON.stringify(
        {
          userId: String(userId),
          updatedAt: new Date().toISOString(),
          storageStatePath,
        },
        null,
        2
      ),
      { mode: 0o600, flag: 'wx' }
    );
    await fs.rename(tmpMetaPath, metaPath);
    return { persisted: true, userDir, storageStatePath, metaPath };
  } catch (err) {
    await fs.unlink(tmpStoragePath).catch(() => {});
    await fs.unlink(tmpMetaPath).catch(() => {});
    logger?.warn?.('failed to persist storage state', {
      userId: String(userId),
      storageStatePath,
      error: err?.message || String(err),
    });
    return { persisted: false, reason: 'error', error: err };
  }
}

export {
  getUserPersistencePaths,
  loadPersistedStorageState,
  persistStorageState,
};
