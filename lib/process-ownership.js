import fs from 'fs';

const BROWSER_PROCESS_RE = /camoufox-bin|\/usr\/bin\/Xvfb\b/;

function readPpid(procRoot, pid) {
  const status = fs.readFileSync(`${procRoot}/${pid}/status`, 'utf8');
  const match = status.match(/^PPid:\s+(\d+)/m);
  if (!match) throw new Error(`missing parent pid for ${pid}`);
  return Number(match[1]);
}

function readStatIdentity(procRoot, pid) {
  // The comm field is parenthesized and may itself contain spaces or `)`, so
  // fields cannot be found with a plain whitespace split. The suffix begins at
  // field 3 (state): PPID is index 1 and starttime (field 22) is index 19.
  const stat = fs.readFileSync(`${procRoot}/${pid}/stat`, 'utf8');
  const commEnd = stat.lastIndexOf(')');
  if (commEnd < 0) throw new Error(`invalid proc stat for ${pid}`);
  const fields = stat.slice(commEnd + 2).trim().split(/\s+/);
  const ppid = Number(fields[1]);
  const startTime = fields[19];
  if (!Number.isInteger(ppid)) throw new Error(`missing parent pid for ${pid}`);
  if (startTime === undefined) throw new Error(`missing starttime for ${pid}`);
  return { ppid, startTime };
}

function readProcess(procRoot, pid) {
  const { ppid, startTime } = readStatIdentity(procRoot, pid);
  const cmdline = fs.readFileSync(`${procRoot}/${pid}/cmdline`, 'utf8');
  return { pid: Number(pid), ppid, startTime, cmdline };
}

function isConfirmedGone(err) {
  return err?.code === 'ENOENT' || err?.code === 'ESRCH';
}

/**
 * Capture browser/Xvfb descendants plus any owned candidates whose procfs
 * identity could not be read conclusively. The latter must make cleanup and
 * memory accounting fail closed rather than being treated as vanished.
 */
export function captureOwnedBrowserProcesses(rootPid, procRoot = '/proc') {
  if (process.platform !== 'linux' && procRoot === '/proc') {
    return { processes: [], indeterminate: [] };
  }

  let entries;
  try {
    entries = fs.readdirSync(procRoot);
  } catch (error) {
    return { processes: [], indeterminate: [{ pid: Number(rootPid), error }] };
  }

  const processes = [];
  const partial = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      processes.push(readProcess(procRoot, entry));
    } catch (error) {
      if (isConfirmedGone(error)) continue;

      let ppid;
      let cmdline = null;
      let detailError = error;
      try {
        ppid = readPpid(procRoot, entry);
      } catch (statusError) {
        if (isConfirmedGone(statusError)) continue;
        detailError = statusError;
      }
      try {
        cmdline = fs.readFileSync(`${procRoot}/${entry}/cmdline`, 'utf8');
      } catch (cmdlineError) {
        if (isConfirmedGone(cmdlineError)) continue;
        detailError = cmdlineError;
      }
      if (Number.isInteger(ppid)) {
        partial.push({ pid: Number(entry), ppid, cmdline, error: detailError });
      }
    }
  }

  const descendants = new Set([Number(rootPid)]);
  const ancestryCandidates = [...processes, ...partial];
  let changed = true;
  while (changed) {
    changed = false;
    for (const proc of ancestryCandidates) {
      if (!descendants.has(proc.pid) && descendants.has(proc.ppid)) {
        descendants.add(proc.pid);
        changed = true;
      }
    }
  }

  return {
    processes: processes.filter(proc => descendants.has(proc.pid) && BROWSER_PROCESS_RE.test(proc.cmdline)),
    indeterminate: partial
      .filter(proc => descendants.has(proc.pid) && (!proc.cmdline || BROWSER_PROCESS_RE.test(proc.cmdline)))
      .map(({ pid, error }) => ({ pid, error })),
  };
}

/** Snapshot browser/Xvfb descendants owned by one server process. */
export function snapshotOwnedBrowserProcesses(rootPid, procRoot = '/proc') {
  return captureOwnedBrowserProcesses(rootPid, procRoot).processes;
}

/**
 * Classify captured processes without treating unreadable state as confirmed
 * disappearance. ENOENT/ESRCH means the process is gone; parse and permission
 * failures are indeterminate and must fail cleanup verification closed.
 */
export function inspectOwnedBrowserProcesses(snapshot, procRoot = '/proc') {
  const survivors = [];
  const indeterminate = [];
  for (const proc of snapshot) {
    try {
      if (readProcess(procRoot, proc.pid).startTime === proc.startTime) survivors.push(proc);
    } catch (err) {
      if (err?.code === 'ENOENT' || err?.code === 'ESRCH') continue;
      indeterminate.push({ proc, error: err });
    }
  }
  return { survivors, indeterminate };
}

/** Return only snapshot members confirmed to still be the same OS processes. */
export function survivingOwnedBrowserProcesses(snapshot, procRoot = '/proc') {
  return inspectOwnedBrowserProcesses(snapshot, procRoot).survivors;
}
