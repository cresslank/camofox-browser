import { describe, expect, jest, test } from '@jest/globals';
import fs from 'node:fs';

// Exercise the actual route without starting a server or browser.
const source = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
const routeStart = source.indexOf("app.post('/tabs/:tabId/fetch-current-resource',");
const routeEnd = source.indexOf('\n// Get captured downloads', routeStart);
if (routeStart < 0 || routeEnd < 0) throw new Error('PDF route boundary not found');
const route = source.slice(routeStart, routeEnd);

function harness({ mimeType = 'application/pdf', declaredBytes = '4', body = Buffer.from('%PDF') } = {}) {
  const response = {
    headers: () => ({ 'content-type': mimeType, 'content-length': declaredBytes }),
    body: jest.fn().mockResolvedValue(body),
    dispose: jest.fn().mockResolvedValue(undefined),
  };
  const get = jest.fn().mockResolvedValue(response);
  const tabState = { page: { url: () => 'https://example.com/document.pdf', context: () => ({ request: { get } }) }, toolCalls: 0 };
  const session = { lastAccess: 0 };
  const capture = jest.fn().mockResolvedValue({ id: 'download', bytes: 4 });
  const log = jest.fn();
  const handleError = jest.fn((_error, _req, res) => res.status(500).json({ error: 'fetch failed' }));
  let handler;
  const dependencies = {
    app: { post: (_path, callback) => { handler = callback; } },
    sessions: new Map([['test-user', session]]), normalizeUserId: value => value,
    findTab: () => ({ tabState }), tabNotFoundResponse: res => res.status(404).json({ error: 'not found' }),
    MAX_FETCHED_RESOURCE_BYTES: 16, captureFetchedResource: capture,
    failuresTotal: { labels: () => ({ inc() {} }) }, classifyError: () => 'unknown',
    log, handleRouteError: handleError,
  };
  new Function(...Object.keys(dependencies), route)(...Object.values(dependencies));
  const req = { body: { userId: 'test-user' }, params: { tabId: 'test-tab' }, reqId: 'test-request' };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json: jest.fn() };
  return { run: () => handler(req, res), response, get, capture, log, handleError, req, res, session };
}

describe('current resource response cleanup', () => {
  test('disposes after successfully saving a PDF', async () => {
    const h = harness();
    await h.run();
    expect(h.res.statusCode).toBe(200);
    expect(h.capture).toHaveBeenCalledTimes(1);
    expect(h.response.dispose).toHaveBeenCalledTimes(1);
    expect(h.session.lastAccess).toBeGreaterThan(0);
  });
  test.each([
    [{ mimeType: 'text/html' }, 415],
    [{ declaredBytes: '17' }, 413],
    [{ declaredBytes: undefined, body: Buffer.alloc(17) }, 413],
  ])('disposes rejected responses: %j', async (options, status) => {
    const h = harness(options);
    await h.run();
    expect(h.res.statusCode).toBe(status);
    expect(h.capture).not.toHaveBeenCalled();
    expect(h.response.dispose).toHaveBeenCalledTimes(1);
  });
  test.each(['body', 'capture'])('disposes when %s fails', async target => {
    const h = harness();
    (target === 'body' ? h.response.body : h.capture).mockRejectedValue(new Error('test failure'));
    await h.run();
    expect(h.res.statusCode).toBe(500);
    expect(h.response.dispose).toHaveBeenCalledTimes(1);
  });
  test('does not dispose a response that was never acquired', async () => {
    const h = harness();
    h.get.mockRejectedValue(new Error('network failed'));
    await h.run();
    expect(h.handleError).toHaveBeenCalledTimes(1);
    expect(h.response.dispose).not.toHaveBeenCalled();
  });
  test('logs cleanup failures without replacing the completed response', async () => {
    const h = harness();
    h.response.dispose.mockRejectedValue(new Error('context closed'));
    await expect(h.run()).resolves.toBeUndefined();
    expect(h.res.json).toHaveBeenCalledTimes(1);
    expect(h.handleError).not.toHaveBeenCalled();
    expect(h.log).toHaveBeenCalledWith('warn', 'fetch current resource response cleanup failed', expect.any(Object));
  });
});
