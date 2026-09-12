/**
 * Regression coverage for detached targets and the removed mouse fallback.
 * A stale target must fail before dispatch without entering a second pointer
 * path or leaking a timeout classification that destroys the tab.
 */
import { describe, test, expect, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { dispatchClickOnce } from '../../lib/click-action.js';
import { isTimeoutError } from '../../lib/browser-errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(join(__dirname, '../../server.js'), 'utf8');

describe('/click detached-target fail-closed behavior', () => {
  test('route no longer contains a raw mouse or DOM activation fallback', () => {
    const start = serverSrc.indexOf("app.post('/tabs/:tabId/click'");
    const route = serverSrc.slice(start, serverSrc.indexOf("app.post('/tabs/:tabId/upload'", start));
    expect(route).not.toContain('boundingBox(');
    expect(route).not.toContain('page.mouse.');
    expect(route).not.toContain('element.click()');
    expect(route).toContain('dispatchClickOnce({');
  });

  test('missing target fails before dispatch with a stable 422', async () => {
    const locator = {
      evaluate: jest.fn(async () => {
        throw Object.assign(new Error('locator.evaluate: Timeout 3000ms exceeded.'), { name: 'TimeoutError' });
      }),
    };
    const dispatch = jest.fn();

    const error = await dispatchClickOnce({ locator, dispatch }).catch(caught => caught);
    expect(error).toMatchObject({ code: 'element_not_actionable', statusCode: 422 });
    expect(error.message).toBe('Element not actionable: target is missing or detached');
    expect(isTimeoutError(error)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
