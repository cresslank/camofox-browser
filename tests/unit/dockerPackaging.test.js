import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';

const dockerignore = readFileSync(new URL('../../.dockerignore', import.meta.url), 'utf8');

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

  test('cannot copy ambient dependency trees from the build context', () => {
    expect(dockerignore).toMatch(/^\*\*\/node_modules$/m);
    expect(dockerignore).toMatch(/^\*\*\/node_modules\/\*\*$/m);
    expect(dockerignore).toMatch(/^\*\*\/\*\.tgz$/m);
    expect(source).not.toMatch(/^COPY\s+(?:--\S+\s+)*\.\s+/m);
  });

  test('accepts an immutable OCI source revision label', () => {
    expect(source).toMatch(/^ARG SOURCE_REVISION$/m);
    expect(source).toContain('org.opencontainers.image.revision="${SOURCE_REVISION}"');
  });
});