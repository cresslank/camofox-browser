import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const dockerignore = readFileSync(new URL('.dockerignore', root), 'utf8');
const workflow = readFileSync(new URL('.github/workflows/docker.yml', root), 'utf8');
const makefile = readFileSync(new URL('Makefile', root), 'utf8');
const powershell = readFileSync(new URL('build.ps1', root), 'utf8');

const escapedLine = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const expectIgnoreLine = value => {
  expect(dockerignore).toMatch(new RegExp(`^${escapedLine(value)}$`, 'm'));
};

describe.each(['Dockerfile', 'Dockerfile.ci'])('%s publication closure', dockerfile => {
  const source = readFileSync(new URL(dockerfile, root), 'utf8');

  test('ships the committed OpenAPI and interactive docs assets', () => {
    expect(source).toMatch(/^COPY openapi\.json \.\/$/m);
    expect(source).toMatch(/^COPY docs\/ \.\/docs\/$/m);
  });

  test('supports browser-free image startup validation', () => {
    expect(source).toContain('ARG CAMOFOX_SKIP_BROWSER_DOWNLOAD=0');
    expect(source).toContain('CAMOFOX_SKIP_BROWSER_DOWNLOAD');
  });

  test('cannot copy the whole ambient build context', () => {
    expect(source).not.toMatch(/^COPY\s+(?:--\S+\s+)*\.\s+/m);
  });

  test('requires an immutable OCI source revision label', () => {
    expect(source).toMatch(/^ARG SOURCE_REVISION$/m);
    expect(source).toContain('test -n "${SOURCE_REVISION}"');
    expect(source).toContain('org.opencontainers.image.revision="${SOURCE_REVISION}"');
  });
});

test('recursively excludes ambient build, log, cache, editor, and OS artifacts', () => {
  for (const directory of [
    'node_modules', 'coverage', '.nyc_output', 'dist', 'build', 'out', 'target',
    'test-results', 'playwright-report', 'logs', 'cache', '.cache', '.camoufox',
    '.pytest_cache', '.parcel-cache', '.turbo', '.next', '.nuxt', '.vite',
    '.idea', '.vscode',
  ]) {
    expectIgnoreLine(`**/${directory}`);
    expectIgnoreLine(`**/${directory}/**`);
  }

  for (const residue of ['**/.DS_Store', '**/Thumbs.db', '**/Desktop.ini', '**/._*']) {
    expectIgnoreLine(residue);
  }
});

test('GHCR and local publication paths pass the exact source revision', () => {
  expect(workflow).toMatch(/build-args:\s*\|\s*\n\s*SOURCE_REVISION=\$\{\{ github\.sha \}\}/);

  expect(makefile).toContain('SOURCE_REVISION ?= $(shell git rev-parse --verify HEAD 2>/dev/null)');
  expect(makefile).toContain('test -n "$(SOURCE_REVISION)"');
  expect(makefile).toContain('--build-arg SOURCE_REVISION="$(SOURCE_REVISION)"');

  expect(powershell).toContain("git -C $ProjectRoot rev-parse --verify 'HEAD^{commit}'");
  expect(powershell).toContain("[string]::IsNullOrWhiteSpace($SourceRevision)");
  expect(powershell).toContain('--build-arg "SOURCE_REVISION=$SourceRevision"');
});

test('the Makefile build command resolves SOURCE_REVISION to the checked-out HEAD', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const command = execFileSync('make', ['--dry-run', 'build'], { cwd: root, encoding: 'utf8' });
  expect(command).toContain(`--build-arg SOURCE_REVISION="${head}"`);
});
