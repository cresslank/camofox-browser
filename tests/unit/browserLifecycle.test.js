import { describe, expect, test } from '@jest/globals';
import {
  browserLaunchCancelledError,
  browserStartCancelledError,
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
    let stopResult;

    const stopping = cancelPendingBrowserLaunch(fence, launch.promise)
      .then((result) => { stopResult = result; stopSettled = true; });

    expect(fence.isCurrent(token)).toBe(false);
    await Promise.resolve();
    expect(stopSettled).toBe(false);

    launch.reject(browserLaunchCancelledError());
    await stopping;
    expect(stopSettled).toBe(true);
    expect(stopResult).toEqual({ cleanupVerified: true, error: null });
  });

  test('a hung raw launch is bounded and fails cleanup verification', async () => {
    const fence = createBrowserLaunchFence();
    const result = await cancelPendingBrowserLaunch(fence, new Promise(() => {}), { timeoutMs: 1 });
    expect(result.cleanupVerified).toBe(false);
    expect(result.error).toContain('browser launch cleanup timeout');
  });

  test('an unverified candidate cleanup is propagated to stop', async () => {
    const fence = createBrowserLaunchFence();
    const error = browserLaunchCancelledError();
    error.cleanupVerified = false;
    const result = await cancelPendingBrowserLaunch(fence, Promise.reject(error));
    expect(result).toEqual({ cleanupVerified: false, error: error.message });
  });

  test('a stop without an active launch still invalidates prior tokens', async () => {
    const fence = createBrowserLaunchFence();
    const token = fence.capture();
    await cancelPendingBrowserLaunch(fence, null);
    expect(fence.isCurrent(token)).toBe(false);
  });

  test('start cancellation errors are distinguishable from launch cancellation', () => {
    const error = browserStartCancelledError();
    expect(error.code).toBe('BROWSER_START_CANCELLED');
  });

  test('cancellation errors are distinguishable from launch failures', () => {
    expect(browserLaunchCancelledError()).toMatchObject({
      code: 'BROWSER_LAUNCH_CANCELLED',
      message: 'browser launch cancelled by concurrent stop',
    });
  });
});
