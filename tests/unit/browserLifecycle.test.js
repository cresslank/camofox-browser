import { describe, expect, test } from '@jest/globals';
import {
  browserLaunchCancelledError,
  cancelPendingBrowserLaunch,
  createBrowserLaunchFence,
} from '../../lib/browser-lifecycle.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('browser lifecycle fence', () => {
  test('a concurrent stop invalidates the launch and waits for it to settle', async () => {
    const fence = createBrowserLaunchFence();
    const token = fence.capture();
    const launch = deferred();
    let stopSettled = false;

    const stopping = cancelPendingBrowserLaunch(fence, launch.promise)
      .then(() => { stopSettled = true; });

    expect(fence.isCurrent(token)).toBe(false);
    await Promise.resolve();
    expect(stopSettled).toBe(false);

    launch.reject(browserLaunchCancelledError());
    await stopping;
    expect(stopSettled).toBe(true);
  });

  test('a stop without an active launch still invalidates prior tokens', async () => {
    const fence = createBrowserLaunchFence();
    const token = fence.capture();
    await cancelPendingBrowserLaunch(fence, null);
    expect(fence.isCurrent(token)).toBe(false);
  });

  test('cancellation errors are distinguishable from launch failures', () => {
    expect(browserLaunchCancelledError()).toMatchObject({
      code: 'BROWSER_LAUNCH_CANCELLED',
      message: 'browser launch cancelled by concurrent stop',
    });
  });
});
