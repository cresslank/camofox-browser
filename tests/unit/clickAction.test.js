import { jest } from '@jest/globals';
import { dispatchClickOnce } from '../../lib/click-action.js';

const timeoutError = () => Object.assign(new Error('locator.click: Timeout 3000ms exceeded.'), { name: 'TimeoutError' });
const actionableLocator = () => ({ evaluate: jest.fn(async () => ({ ok: true })) });

describe('dispatchClickOnce', () => {
  test('normal click passes a side-effect-free actionability check before one dispatch', async () => {
    const calls = [];
    const locator = { evaluate: jest.fn(async (...args) => {
      calls.push(['check', args[2]]);
      return { ok: true };
    }) };
    const dispatch = jest.fn(async options => calls.push(['dispatch', options]));

    await dispatchClickOnce({ locator, dispatch, timeout: 1234, clickCount: 2 });

    expect(calls).toEqual([
      ['check', { timeout: 1234 }],
      ['dispatch', { timeout: 1234, clickCount: 2 }],
    ]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  test('failed actionability check never dispatches', async () => {
    const locator = { evaluate: jest.fn(async () => ({ ok: false, reason: 'target is disabled' })) };
    const dispatch = jest.fn();

    await expect(dispatchClickOnce({ locator, dispatch })).rejects.toMatchObject({
      code: 'element_not_actionable',
      statusCode: 422,
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  test('missing target check never dispatches or leaks a timeout classification', async () => {
    const locator = { evaluate: jest.fn(async () => { throw timeoutError(); }) };
    const dispatch = jest.fn();

    const error = await dispatchClickOnce({ locator, dispatch }).catch(caught => caught);
    expect(error).toMatchObject({ code: 'element_not_actionable', statusCode: 422 });
    expect(error.message).not.toMatch(/timeout|timed out/i);
    expect(dispatch).not.toHaveBeenCalled();
  });

  test('ambiguous timeout after a side effect is reported unknown and never dispatched again', async () => {
    let sideEffects = 0;
    const locator = actionableLocator();
    const dispatch = jest.fn(async () => {
      sideEffects += 1;
      throw timeoutError();
    });

    await expect(dispatchClickOnce({ locator, dispatch })).rejects.toMatchObject({
      code: 'click_outcome_unknown',
      statusCode: 409,
      outcome: 'unknown',
      retryable: false,
    });
    expect(sideEffects).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  test('explicit force skips the check but still dispatches only once', async () => {
    const locator = { evaluate: jest.fn() };
    const dispatch = jest.fn(async () => {});

    await dispatchClickOnce({ locator, dispatch, force: true });

    expect(locator.evaluate).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ timeout: 3000, force: true });
  });
});
