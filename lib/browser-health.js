const INTENTIONAL_STOP_REASONS = new Set([
  'idle_shutdown',
  'admin_stop',
  'browser_rss_pressure',
  'memory_pressure',
]);

export function browserCloseStarted(reason) {
  return {
    closeState: { inProgress: true, failed: false, reason, error: null },
    lastStopReason: null,
  };
}

export function browserCloseCompleted(reason, { cleanupVerified, error = null } = {}) {
  const failed = !cleanupVerified;
  return {
    closeState: { inProgress: false, failed, reason, error },
    lastStopReason: failed ? `browser_close_failed:${reason}` : reason,
  };
}

/**
 * Classify browser availability for the production /health route.
 * Close progress/failure state takes precedence over the last completed stop.
 */
export function browserHealthDecision({
  running,
  isRecovering = false,
  closeState = {},
  lastStopReason = null,
}) {
  if (isRecovering) {
    return { ok: false, recovering: true, reason: 'browser_recovery', shouldRetry: false };
  }
  if (closeState.inProgress) {
    return {
      ok: false,
      recovering: true,
      reason: `browser_close_in_progress:${closeState.reason || 'unknown'}`,
      shouldRetry: false,
    };
  }
  if (closeState.failed) {
    return {
      ok: false,
      recovering: false,
      reason: `browser_close_failed:${closeState.reason || 'unknown'}`,
      shouldRetry: false,
    };
  }
  if (!running && lastStopReason && !INTENTIONAL_STOP_REASONS.has(lastStopReason)) {
    return { ok: false, recovering: false, reason: lastStopReason, shouldRetry: true };
  }
  return { ok: true, recovering: false, reason: lastStopReason, shouldRetry: false };
}

export function isIntentionalBrowserStop(reason) {
  return INTENTIONAL_STOP_REASONS.has(reason);
}
