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
export async function cancelPendingBrowserLaunch(fence, pendingLaunch) {
  fence.cancel();
  if (!pendingLaunch) return;
  try {
    await pendingLaunch;
  } catch {
    // Cancellation is expected to reject the original /start request.
  }
}

export function browserLaunchCancelledError() {
  const error = new Error('browser launch cancelled by concurrent stop');
  error.code = 'BROWSER_LAUNCH_CANCELLED';
  return error;
}
