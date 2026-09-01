import { normalizeBlockedResourceTypes } from './resource-blocking.js';

/**
 * Create a replacement page and install its request routing before callers can
 * register, navigate, or otherwise expose it as a managed tab.
 */
export async function createRoutedReplacementPage({
  session,
  blockedResourceTypes,
  createLeasedPage,
  closeLeasedPage,
  applyResourceBlocking,
}) {
  const canonicalTypes = normalizeBlockedResourceTypes(blockedResourceTypes);
  const created = await createLeasedPage(session);
  try {
    const appliedTypes = await applyResourceBlocking(created.page, canonicalTypes);
    return {
      ...created,
      blockedResourceTypes: normalizeBlockedResourceTypes(appliedTypes),
    };
  } catch (error) {
    await closeLeasedPage(session, created.page, created.lease);
    throw error;
  }
}
