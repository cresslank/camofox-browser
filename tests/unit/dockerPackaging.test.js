import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';

describe.each(['Dockerfile', 'Dockerfile.ci'])('%s publication closure', dockerfile => {
  const source = readFileSync(new URL(`../../${dockerfile}`, import.meta.url), 'utf8');

  test('ships the committed OpenAPI and interactive docs assets', () => {
    expect(source).toMatch(/^COPY openapi\.json \.\/$/m);
    expect(source).toMatch(/^COPY docs\/ \.\/docs\/$/m);
  });

  test('supports browser-free image startup validation', () => {
    expect(source).toContain('ARG CAMOFOX_SKIP_BROWSER_DOWNLOAD=0');
    expect(source).toContain('CAMOFOX_SKIP_BROWSER_DOWNLOAD');
  });
});