// lib/resources.js -- Process resource metrics and proxy error classification.
// Isolated from reporter.js so that fs reads and network sends are never
// in the same file (keeps fs reads and network sends in separate modules).

import fs from 'fs';
import { snapshotOwnedBrowserProcesses, survivingOwnedBrowserProcesses } from './process-ownership.js';

// ============================================================================
// Process resource snapshot (memory, handles, FDs, browser RSS)
// ============================================================================

/**
 * Collect process-level resource metrics. Safe to call at any time.
 * Returns anonymized metrics -- no PIDs, paths, or user data.
 */
function readVmRssKb(pid, procRoot = '/proc') {
  const status = fs.readFileSync(`${procRoot}/${pid}/status`, 'utf8');
  const match = status.match(/VmRSS:\s+(\d+)\s+kB/);
  return match ? parseInt(match[1], 10) : 0;
}

function readPssKb(pid, procRoot = '/proc') {
  try {
    const rollup = fs.readFileSync(`${procRoot}/${pid}/smaps_rollup`, 'utf8');
    const match = rollup.match(/^Pss:\s+(\d+)\s+kB/m);
    if (match) return parseInt(match[1], 10);
  } catch {
    // Kernels or sandboxes without smaps_rollup fall back to scoped RSS.
  }
  return readVmRssKb(pid, procRoot);
}

function readChildPids(pid, procRoot = '/proc') {
  const childrenPath = `${procRoot}/${pid}/task/${pid}/children`;
  const raw = fs.readFileSync(childrenPath, 'utf8').trim();
  if (!raw) return [];
  return raw.split(/\s+/).map((child) => parseInt(child, 10)).filter(Number.isInteger);
}

function sumProcessTreeMb(rootPids, readMemoryKb, procRoot = '/proc') {
  const seen = new Set();
  let totalKb = 0;
  const stack = [...rootPids];
  let found = false;

  while (stack.length > 0) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    try {
      totalKb += readMemoryKb(pid, procRoot);
      found = true;
      stack.push(...readChildPids(pid, procRoot));
    } catch {
      // Process exited or /proc access failed; skip it.
    }
  }

  return found ? Math.round(totalKb / 1024) : null;
}

/**
 * Sum RSS for a browser process tree. This intentionally includes child content
 * processes because Firefox/Camoufox memory pressure mostly lives outside Node.
 */
export function browserProcessTreeRssMb(browserPid, { procRoot = '/proc' } = {}) {
  if (process.platform !== 'linux' && procRoot === '/proc') return null;
  if (!browserPid || !Number.isInteger(browserPid) || browserPid <= 0) return null;
  return sumProcessTreeMb([browserPid], readVmRssKb, procRoot);
}

export function browserProcessTreePssMb(browserPid, { procRoot = '/proc' } = {}) {
  if (process.platform !== 'linux' && procRoot === '/proc') return null;
  if (!browserPid || !Number.isInteger(browserPid) || browserPid <= 0) return null;
  return sumProcessTreeMb([browserPid], readPssKb, procRoot);
}

function sumOwnedProcessListMb(processes, readMemoryKb, procRoot = '/proc') {
  let totalKb = 0;
  let found = false;

  for (const ownedProcess of processes) {
    try {
      const memoryKb = readMemoryKb(ownedProcess.pid, procRoot);
      // Verify process identity after the read so PID reuse cannot charge an
      // unrelated process to this server's browser.
      if (survivingOwnedBrowserProcesses([ownedProcess], procRoot).length === 0) continue;
      totalKb += memoryKb;
      found = true;
    } catch {
      // Process exited or /proc access failed; skip it.
    }
  }

  return found ? Math.round(totalKb / 1024) : null;
}

/**
 * Sum proportional memory for browser/Xvfb processes owned by this server.
 * Playwright's Browser object does not always expose process(), so the fallback
 * filters the server's descendants through the same command and process-start
 * identity checks used by browser cleanup. Non-browser plugin helpers are not
 * included.
 */
export function browserOwnedProcessPssMb(ownerPid, { procRoot = '/proc' } = {}) {
  if (process.platform !== 'linux' && procRoot === '/proc') return null;
  if (!ownerPid || !Number.isInteger(ownerPid) || ownerPid <= 0) return null;
  try {
    const ownedProcesses = snapshotOwnedBrowserProcesses(ownerPid, procRoot);
    if (ownedProcesses.length === 0) return null;
    return sumOwnedProcessListMb(ownedProcesses, readPssKb, procRoot);
  } catch {
    return null;
  }
}

/** @deprecated Use browserOwnedProcessPssMb. */
export function browserDescendantTreePssMb(ownerPid, options = {}) {
  return browserOwnedProcessPssMb(ownerPid, options);
}

/**
 * @deprecated Host-wide process-name accounting was unsafe because it included
 * unrelated Firefox-family processes. A zero-argument legacy call now fails
 * closed; callers with an ownership root receive owned-descendant PSS.
 */
export function browserProcessNameRssMb(ownerPid = null, options = {}) {
  if (!ownerPid || !Number.isInteger(ownerPid) || ownerPid <= 0) return null;
  return browserOwnedProcessPssMb(ownerPid, options);
}

export function evaluateBrowserMemoryPressure({
  browserMemoryMb,
  thresholdMb,
  launchedAt,
  now = Date.now(),
  consecutiveOverThreshold = 0,
  graceMs = 60_000,
  requiredSamples = 2,
}) {
  if (browserMemoryMb === null || browserMemoryMb === undefined) {
    return { action: 'unavailable', consecutiveOverThreshold: 0 };
  }
  if (!launchedAt || now - launchedAt < graceMs) {
    return { action: 'grace', consecutiveOverThreshold: 0 };
  }
  if (browserMemoryMb < thresholdMb) {
    return { action: 'ok', consecutiveOverThreshold: 0 };
  }
  const nextCount = consecutiveOverThreshold + 1;
  if (nextCount < requiredSamples) {
    return { action: 'observe', consecutiveOverThreshold: nextCount };
  }
  return { action: 'restart', consecutiveOverThreshold: 0 };
}

export function collectResourceSnapshot(opts = {}) {
  const mem = process.memoryUsage();
  const snap = {
    nodeRssMb: Math.round(mem.rss / 1048576),
    nodeHeapUsedMb: Math.round(mem.heapUsed / 1048576),
    nodeHeapTotalMb: Math.round(mem.heapTotal / 1048576),
    nodeExternalMb: Math.round(mem.external / 1048576),
    eventLoopLagMs: null,
    activeHandles: null,
    activeRequests: null,
    openFds: null,
    browserRssMb: null,
  };

  // Active libuv handles/requests (private API, guarded)
  try { snap.activeHandles = process._getActiveHandles().length; } catch { /* unavailable */ }
  try { snap.activeRequests = process._getActiveRequests().length; } catch { /* unavailable */ }

  // Open file descriptors (Linux only)
  try {
    if (process.platform === 'linux') {
      snap.openFds = fs.readdirSync('/proc/self/fd').length;
    }
  } catch { /* not available or permission denied */ }

  // Browser process RSS (the one people miss -- browser OOMs, not Node)
  snap.browserRssMb = browserProcessTreeRssMb(opts.browserPid);

  // Session/tab counts from caller
  if (opts.sessionCount != null) snap.browserContexts = opts.sessionCount;
  if (opts.tabCount != null) snap.activeTabs = opts.tabCount;

  return snap;
}

// ============================================================================
// Proxy error classification
// ============================================================================

/**
 * Classify proxy errors from Playwright navigation error messages.
 * Returns { proxyError: string|null, proxyTlsError: bool } -- no IPs or credentials.
 */
export function classifyProxyError(errorMessage) {
  if (!errorMessage || typeof errorMessage !== 'string') return { proxyError: null, proxyTlsError: false };
  const msg = errorMessage.toUpperCase();
  if (msg.includes('ERR_PROXY_CONNECTION_FAILED')) return { proxyError: 'ERR_PROXY_CONNECTION_FAILED', proxyTlsError: false };
  if (msg.includes('ERR_TUNNEL_CONNECTION_FAILED')) return { proxyError: 'ERR_TUNNEL_CONNECTION_FAILED', proxyTlsError: false };
  if (msg.includes('ERR_PROXY_AUTH_REQUESTED') || msg.includes('407')) return { proxyError: 'ERR_PROXY_AUTH_REQUESTED', proxyTlsError: false };
  if (msg.includes('ERR_PROXY_CERTIFICATE_INVALID') || (msg.includes('PROXY') && msg.includes('SSL'))) return { proxyError: 'ERR_PROXY_TLS', proxyTlsError: true };
  if (msg.includes('ECONNREFUSED') && msg.includes('PROXY')) return { proxyError: 'ECONNREFUSED', proxyTlsError: false };
  if (msg.includes('ETIMEDOUT') && msg.includes('PROXY')) return { proxyError: 'ETIMEDOUT', proxyTlsError: false };
  return { proxyError: null, proxyTlsError: false };
}
