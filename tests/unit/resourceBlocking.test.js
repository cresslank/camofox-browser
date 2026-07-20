import { describe, expect, jest, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { applyResourceBlocking, normalizeBlockedResourceTypes } from '../../lib/resource-blocking.js';

const serverSource = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');

describe('resource blocking', () => {
  test('normalizes supported aliases and ignores unknown values', () => {
    expect(normalizeBlockedResourceTypes('images, video fonts script IMAGE')).toEqual([
      'image',
      'media',
      'font',
    ]);
    expect(normalizeBlockedResourceTypes(null)).toEqual([]);
  });

  test('aborts blocked resource types and continues other requests', async () => {
    let handler;
    const page = { route: jest.fn(async (_pattern, callback) => { handler = callback; }) };
    const blocked = await applyResourceBlocking(page, ['image', 'audio']);

    expect(blocked).toEqual(['image', 'media']);
    expect(page.route).toHaveBeenCalledWith('**/*', expect.any(Function));

    const imageRoute = {
      request: () => ({ resourceType: () => 'image' }),
      abort: jest.fn(),
      continue: jest.fn(),
    };
    await handler(imageRoute);
    expect(imageRoute.abort).toHaveBeenCalledTimes(1);
    expect(imageRoute.continue).not.toHaveBeenCalled();

    const scriptRoute = {
      request: () => ({ resourceType: () => 'script' }),
      abort: jest.fn(),
      continue: jest.fn(),
    };
    await handler(scriptRoute);
    expect(scriptRoute.continue).toHaveBeenCalledTimes(1);
    expect(scriptRoute.abort).not.toHaveBeenCalled();
  });

  test('does not install a route when no supported type is requested', async () => {
    const page = { route: jest.fn() };
    await expect(applyResourceBlocking(page, ['script'])).resolves.toEqual([]);
    expect(page.route).not.toHaveBeenCalled();
  });

  test('configures both initial and proxy-retry tab creation paths', () => {
    const configuredCreationCalls = serverSource.match(
      /createPageWithRecoveryForUser\(userId, session, \{\s*trace: !!trace,\s*blockedResourceTypes: blockedTypes,\s*\}\)/g,
    );
    expect(configuredCreationCalls).toHaveLength(2);

    const proxyRetry = serverSource.slice(serverSource.indexOf("browserRestartsTotal.labels('proxy_retry')"));
    expect(proxyRetry.indexOf('blockedResourceTypes: blockedTypes')).toBeGreaterThan(-1);
    expect(proxyRetry.indexOf('blockedResourceTypes: blockedTypes')).toBeLessThan(proxyRetry.indexOf('const retryGroup'));
  });
});
