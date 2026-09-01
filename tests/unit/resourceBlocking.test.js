import { describe, expect, jest, test } from '@jest/globals';
import { applyResourceBlocking, normalizeBlockedResourceTypes } from '../../lib/resource-blocking.js';
import { createRoutedReplacementPage } from '../../lib/replacement-page.js';

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

  test.each(['Google rotation', 'navigation-context recovery'])(
    '%s routes a replacement before making it available',
    async () => {
      const page = { id: 'replacement' };
      const lease = { id: 'lease' };
      let finishRouting;
      const routing = new Promise(resolve => { finishRouting = resolve; });
      const createLeasedPage = jest.fn(async () => ({ page, lease }));
      const applyBlocking = jest.fn(async () => {
        await routing;
        return ['image', 'media', 'font'];
      });
      const closeLeasedPage = jest.fn();

      let exposed = false;
      const replacementPromise = createRoutedReplacementPage({
        session: { id: 'fresh-context' },
        blockedResourceTypes: ['images', 'video', 'fonts'],
        createLeasedPage,
        closeLeasedPage,
        applyResourceBlocking: applyBlocking,
      }).then(result => { exposed = true; return result; });

      await Promise.resolve();
      expect(exposed).toBe(false);
      expect(applyBlocking).toHaveBeenCalledWith(page, ['image', 'media', 'font']);
      finishRouting();

      await expect(replacementPromise).resolves.toEqual({
        page,
        lease,
        blockedResourceTypes: ['image', 'media', 'font'],
      });
      expect(closeLeasedPage).not.toHaveBeenCalled();
    },
  );

  test('closes and withholds a replacement whose routing setup fails', async () => {
    const page = { id: 'replacement' };
    const lease = { id: 'lease' };
    const session = { id: 'fresh-context' };
    const routeError = new Error('route setup failed');
    const closeLeasedPage = jest.fn();

    await expect(createRoutedReplacementPage({
      session,
      blockedResourceTypes: ['image'],
      createLeasedPage: async () => ({ page, lease }),
      closeLeasedPage,
      applyResourceBlocking: async () => { throw routeError; },
    })).rejects.toBe(routeError);
    expect(closeLeasedPage).toHaveBeenCalledWith(session, page, lease);
  });
});
