import { describe, expect, test } from '@jest/globals';
import {
  browserCloseCompleted,
  browserCloseStarted,
  browserHealthDecision,
  isIntentionalBrowserStop,
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

  test('reports a connected browser healthy', () => {
    expect(browserHealthDecision({ running: true, lastStopReason: null })).toMatchObject({ ok: true });
  });
});
