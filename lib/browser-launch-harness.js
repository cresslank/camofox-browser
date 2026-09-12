import fs from 'fs';

function appendHarnessEvent(eventsPath, event) {
  fs.appendFileSync(eventsPath, `${JSON.stringify({ ...event, at: Date.now() })}\n`, 'utf8');
}

function createFakeBrowser(eventsPath, call) {
  let connected = true;
  return {
    isConnected: () => connected,
    process: () => null,
    close: async () => {
      if (!connected) return;
      connected = false;
      appendHarnessEvent(eventsPath, { event: 'browser-close', call });
    },
  };
}

/**
 * Wrap Playwright's Firefox launch for a process-level lifecycle race harness.
 * The fake is available only when loadConfig() explicitly enables it in
 * NODE_ENV=test; production always calls the supplied Playwright launcher.
 */
export function createBrowserLauncher(realLaunch, testHarness = null) {
  if (!testHarness) return realLaunch;

  let call = 0;
  return async function launchWithDeterministicDelay(options) {
    call += 1;
    const currentCall = call;
    const delayMs = testHarness.delaysMs[currentCall - 1] ?? testHarness.delaysMs.at(-1) ?? 0;
    appendHarnessEvent(testHarness.eventsPath, { event: 'launch-start', call: currentCall, delayMs });
    await new Promise(resolve => setTimeout(resolve, delayMs));
    appendHarnessEvent(testHarness.eventsPath, { event: 'launch-return', call: currentCall });
    return createFakeBrowser(testHarness.eventsPath, currentCall);
  };
}
