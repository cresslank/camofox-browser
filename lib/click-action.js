function messageOf(error) {
  return String(error?.message || error || '');
}

export function isClickTimeout(error) {
  const message = messageOf(error).toLowerCase();
  return error?.name === 'TimeoutError' || message.includes('timeout') || message.includes('timed out');
}

function notActionableError(reason, cause) {
  const error = new Error(`Element not actionable: ${reason || 'actionability check failed'}`);
  error.name = 'ElementNotActionableError';
  error.code = 'element_not_actionable';
  error.statusCode = 422;
  error.cause = cause;
  return error;
}

function outcomeUnknownError(cause) {
  const error = new Error('Click was dispatched but completion was not acknowledged. Outcome is unknown; the action was not retried.');
  error.name = 'ClickOutcomeUnknownError';
  error.code = 'click_outcome_unknown';
  error.statusCode = 409;
  error.outcome = 'unknown';
  error.retryable = false;
  error.cause = cause;
  return error;
}

async function assertDomActionable(locator, timeout) {
  let result;
  try {
    result = await locator.evaluate((element) => {
      if (!element?.isConnected) return { ok: false, reason: 'target is detached' };
      if (element.matches?.(':disabled')) return { ok: false, reason: 'target is disabled' };
      if (element.getAttribute?.('aria-disabled')?.toLowerCase() === 'true') {
        return { ok: false, reason: 'target is aria-disabled' };
      }

      const style = element.ownerDocument.defaultView.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
        return { ok: false, reason: 'target is not visible' };
      }
      if (style.pointerEvents === 'none') return { ok: false, reason: 'target does not receive pointer events' };

      const rects = Array.from(element.getClientRects());
      const rect = rects.find(candidate => candidate.width > 0 && candidate.height > 0);
      if (!rect) return { ok: false, reason: 'target has no visible bounding box' };

      const view = element.ownerDocument.defaultView;
      const left = Math.max(0, rect.left);
      const right = Math.min(view.innerWidth, rect.right);
      const top = Math.max(0, rect.top);
      const bottom = Math.min(view.innerHeight, rect.bottom);
      if (right <= left || bottom <= top) return { ok: false, reason: 'target is outside the viewport' };

      const x = left + (right - left) / 2;
      const y = top + (bottom - top) / 2;
      const hit = element.ownerDocument.elementFromPoint(x, y);
      if (!hit || (hit !== element && !element.contains(hit))) {
        return { ok: false, reason: 'target is intercepted by another element' };
      }
      return { ok: true };
    }, undefined, { timeout });
  } catch (error) {
    if (isClickTimeout(error) || /not attached|detached|waiting for locator/i.test(messageOf(error))) {
      throw notActionableError('target is missing or detached', error);
    }
    throw error;
  }
  if (!result?.ok) throw notActionableError(result?.reason);
}

/**
 * Perform one click without replaying an action across an ambiguous protocol
 * boundary. Normal clicks receive a side-effect-free DOM actionability check;
 * Playwright then performs its own normal checks during the sole dispatch.
 * Once that dispatch begins, a timeout is indeterminate and is returned without
 * another click attempt. This is intentionally not a general at-most-once
 * guarantee across protocol ambiguity.
 *
 * `force` is deliberately explicit. It preserves Playwright's documented force
 * behavior for callers that opt in, but is never selected as a fallback.
 */
export async function dispatchClickOnce({ locator, dispatch, timeout = 3000, force = false, clickCount }) {
  const baseOptions = { timeout };
  if (clickCount) baseOptions.clickCount = clickCount;

  if (!force) await assertDomActionable(locator, timeout);

  try {
    await dispatch({ ...baseOptions, ...(force ? { force: true } : {}) });
  } catch (error) {
    if (isClickTimeout(error)) throw outcomeUnknownError(error);
    throw error;
  }
}
