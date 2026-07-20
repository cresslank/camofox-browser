const RESOURCE_BLOCK_ALIASES = new Map([
  ['image', 'image'],
  ['images', 'image'],
  ['img', 'image'],
  ['media', 'media'],
  ['audio', 'media'],
  ['video', 'media'],
  ['font', 'font'],
  ['fonts', 'font'],
]);

export function normalizeBlockedResourceTypes(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,]+/)
      : [];
  const blocked = [];
  const seen = new Set();
  for (const item of raw) {
    const normalized = RESOURCE_BLOCK_ALIASES.get(String(item).trim().toLowerCase());
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      blocked.push(normalized);
    }
  }
  return blocked;
}

export async function applyResourceBlocking(page, blockedResourceTypes) {
  const blocked = new Set(normalizeBlockedResourceTypes(blockedResourceTypes));
  if (blocked.size === 0) return [];

  await page.route('**/*', async (route) => {
    const resourceType = route.request().resourceType();
    try {
      if (blocked.has(resourceType)) await route.abort();
      else await route.continue();
    } catch {
      // The page or request may close while the route is being handled.
    }
  });

  return [...blocked];
}
