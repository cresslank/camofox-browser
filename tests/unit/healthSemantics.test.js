import { describe, expect, test } from '@jest/globals';
import {
  browserCleanupExitCode,
  browserCloseCompleted,
  browserCloseStarted,
  browserHealthDecision,
  isIntentionalBrowserStop,
  previousBrowserCleanupFailure,
  shouldScheduleBrowserWarmRetry,
} from '../../lib/browser-health.js';

describe('browser health classification', () => {
  test('reports production close transitions as unhealthy until cleanup succeeds', () => {
    const started = browserCloseStarted('browser_rss_pressure');
    expect(browserHealthDecision({
      running: false,
      closeState: started.closeState,
      lastStopReason: started.lastStopReason,
    })).toMatchObject({ ok: false, recovering: true, shouldRetry: false });

    const failed = browserCloseCompleted('browser_rss_pressure', {
      cleanupVerified: false,
      error: 'survivors remain',
    });
    expect(browserHealthDecision({
      running: false,
      closeState: failed.closeState,
      lastStopReason: failed.lastStopReason,
    })).toMatchObject({
      ok: false,
      recovering: false,
      reason: 'browser_close_failed:browser_rss_pressure',
      shouldRetry: false,
    });

    const completed = browserCloseCompleted('browser_rss_pressure', { cleanupVerified: true });
    expect(browserHealthDecision({
      running: false,
      closeState: completed.closeState,
      lastStopReason: completed.lastStopReason,
    })).toMatchObject({ ok: true, recovering: false });
  });

  test('accepts only completed intentional stops', () => {
    for (const reason of ['idle_shutdown', 'admin_stop', 'browser_rss_pressure', 'memory_pressure']) {
      expect(isIntentionalBrowserStop(reason)).toBe(true);
      expect(browserHealthDecision({ running: false, lastStopReason: reason })).toMatchObject({ ok: true });
    }
  });

  test('requests recovery for unexpected browser absence', () => {
    expect(browserHealthDecision({ running: false, lastStopReason: 'browser_disconnected' })).toEqual({
      ok: false,
      recovering: false,
      reason: 'browser_disconnected',
      shouldRetry: true,
    });
  });

  test('requests recovery for a published but disconnected browser', () => {
    expect(browserHealthDecision({
      running: false,
      browserPresent: true,
      lastStopReason: null,
    })).toEqual({
      ok: false,
      recovering: false,
      reason: 'browser_disconnected',
      shouldRetry: true,
    });
  });

  test('schedules recovery for a disconnected browser but not active lifecycle work', () => {
    expect(shouldScheduleBrowserWarmRetry({ browserConnected: false })).toBe(true);
    expect(shouldScheduleBrowserWarmRetry({ browserConnected: true })).toBe(false);
    expect(shouldScheduleBrowserWarmRetry({ timerActive: true })).toBe(false);
    expect(shouldScheduleBrowserWarmRetry({ launchPending: true })).toBe(false);
  });

  test('retains a failed cleanup across a repeated no-op close', () => {
    const failed = browserCloseCompleted('admin_stop', {
      cleanupVerified: false,
      error: 'survivor state indeterminate',
    });
    expect(previousBrowserCleanupFailure({
      browserPresent: false,
      closeState: failed.closeState,
    })).toEqual({
      cleanupVerified: false,
      error: 'survivor state indeterminate',
      survivors: [],
    });
    expect(previousBrowserCleanupFailure({
      browserPresent: true,
      closeState: failed.closeState,
    })).toBeNull();
  });

  test('shutdown exits nonzero when browser cleanup is not verified', () => {
    expect(browserCleanupExitCode({ cleanupVerified: true })).toBe(0);
    expect(browserCleanupExitCode({ cleanupVerified: false })).toBe(1);
    expect(browserCleanupExitCode(null)).toBe(1);
  });

  test('reports a connected browser healthy', () => {
    expect(browserHealthDecision({ running: true, lastStopReason: null })).toMatchObject({ ok: true });
  });
});
