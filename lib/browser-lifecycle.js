export function createBrowserLaunchFence() {
  let generation = 0;
  return {
    capture: () => generation,
    cancel: () => { generation += 1; return generation; },
    isCurrent: (token) => token === generation,
  };
}

/**
 * Invalidate an in-flight launch and wait until its candidate is closed or the
 * launch otherwise settles. Rejections are returned to the original starter;
 * a concurrent stop only needs settlement before it can report completion.
 */
export async function cancelPendingBrowserLaunch(fence, pendingLaunch, { timeoutMs = 10000 } = {}) {
  fence.cancel();
  if (!pendingLaunch) return { cleanupVerified: true, error: null };
  let timer;
  try {
    await Promise.race([
      pendingLaunch,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`browser launch cleanup timeout after ${timeoutMs}ms`);
          error.cleanupVerified = false;
          reject(error);
        }, timeoutMs);
      }),
    ]);
    return { cleanupVerified: true, error: null };
  } catch (error) {
    if (error?.cleanupVerified !== false) {
      return { cleanupVerified: true, error: null };
    }
    return { cleanupVerified: false, error: error?.message || 'browser launch cleanup failed' };
  } finally {
    clearTimeout(timer);
  }
}

export function browserLaunchCancelledError() {
  const error = new Error('browser launch cancelled by concurrent stop');
  error.code = 'BROWSER_LAUNCH_CANCELLED';
  return error;
}
