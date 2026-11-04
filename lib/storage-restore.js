import fs from 'node:fs/promises';

/** Restore localStorage through bounded parallel, intercepted blank pages.
 * Keep native Playwright restoration for IndexedDB and empty origin lists.
 * A Firefox extension may abort a single origin despite interception; never
 * discard all other origins and cookies because of that navigation failure.
 */
export async function newContextWithStorage(browser, options, log = () => {}) {
  if (!options.storageState) return browser.newContext(options);
  const state = typeof options.storageState === 'string'
    ? JSON.parse(await fs.readFile(options.storageState, 'utf8')) : options.storageState;
  if (!state.origins?.length || state.origins.some(o => o.indexedDB?.length)) {
    return browser.newContext(options);
  }
  const context = await browser.newContext({ ...options, storageState: { ...state, origins: [] } });
  const counts = { restored: 0, skipped_navigation_aborted: 0 };
  const pending = [...state.origins];
  let failure;
  async function blankPage() {
    const page = await context.newPage();
    await page.route('**/*', route => route.fulfill({ body: '<html></html>', contentType: 'text/html' }));
    return page;
  }
  try {
    await Promise.all(Array.from({ length: Math.min(8, pending.length) }, async () => {
      let page;
      try {
        page = await blankPage();
        while (pending.length && !failure) {
          const entry = pending.shift();
          let navigated = false;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              await page.goto(entry.origin, { timeout: 10000, waitUntil: 'load' });
              navigated = true;
              break;
            } catch (error) {
              if (!/^page\.goto: (?:NS_ERROR_ABORT|NS_BINDING_ABORTED)(?:\r?\n|$)/.test(error.message)) throw error;
              // Retry with a fresh page so a transient navigation cancellation
              // does not lose state. Only a repeated abort skips this origin.
              await page.close();
              page = await blankPage();
            }
          }
          if (!navigated) {
            counts.skipped_navigation_aborted++;
            continue;
          }
          await page.evaluate(items => {
            for (const { name, value } of items) localStorage.setItem(name, value);
          }, entry.localStorage || []);
          counts.restored++;
        }
      } catch (error) {
        failure ||= error;
      } finally {
        await page?.close().catch(() => {});
      }
    }));
    if (failure) throw failure;
    // No URLs, cookie names/values, storage keys/values or browser error text.
    log('info', 'persisted origins restored', counts);
    return context;
  } catch (error) {
    await context.close().catch(() => {});
    // The caller must not replace a partially restored profile with an empty
    // checkpoint on unrelated timeout, quota, schema or browser failures.
    error.preserveStorageState = true;
    throw error;
  }
}
