import { describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const root = new URL('../../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
// https://api.github.com/repos/daijro/camoufox/releases/tags/v158.0.1-beta.41
const pins = {
  amd64: '3f2eb1d0451fa58e45e43e55f5e6181565069791ae60c0574f0ceb1f01341c33',
  arm64: '60e25f6eb95e13d9ec655bc02913d51057e669cb31542e6ace9d2190ab5380af',
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const runLine = (source, marker) => source.replace(/\\\r?\n/g, '').split('\n')
  .find(line => line.startsWith('RUN ') && line.includes(marker)).slice(4);

function withFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'camofox-build-assets-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const archive = join(dir, 'fixture.zip');
    const zip = new AdmZip();
    zip.addFile('camoufox-bin', Buffer.from('synthetic browser fixture, never executed\n'));
    zip.addFile('properties.json', Buffer.from('[]'));
    zip.writeZip(archive);
    // Only the external download edge is replaced. Extraction, sha256sum,
    // cache writes, and the installed official launcher's resolver are real.
    writeFileSync(join(bin, 'curl'), `#!/bin/sh
set -eu
out=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
[ "$url" = "$EXPECTED_URL" ] || { printf 'unexpected download: %s\\n' "$url" >&2; exit 1; }
printf '%s\\n' "$url" >> "$DOWNLOAD_LOG"
cp "$FIXTURE_ARCHIVE" "$out"
`, { mode: 0o755 });
    fn({ dir, bin, archive, digest: sha256(readFileSync(archive)) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function executeArchive(source, fixture, target, digest = fixture.digest, skip = '0') {
  const command = runLine(source, 'CAMOUFOX_RELATIVE=')
    .replaceAll('/root/.cache/camoufox', '${TEST_CACHE}')
    .replaceAll('/root/.camoufox', '${TEST_PROFILE}')
    .replaceAll('/tmp/camoufox.zip', '${TEST_ARCHIVE}');
  const arch = target === 'amd64' ? 'x86_64' : 'arm64';
  const env = {
    ...process.env, HOME: fixture.dir, XDG_CACHE_HOME: join(fixture.dir, '.cache'),
    PATH: `${fixture.bin}:${process.env.PATH}`, TARGETARCH: target,
    CAMOUFOX_VERSION: '158.0.1', CAMOUFOX_RELEASE: 'beta.41',
    CAMOUFOX_SHA256_AMD64: digest, CAMOUFOX_SHA256_ARM64: digest,
    CAMOFOX_SKIP_BROWSER_DOWNLOAD: skip,
    TEST_CACHE: join(fixture.dir, '.cache/camoufox'), TEST_PROFILE: join(fixture.dir, '.camoufox'),
    TEST_ARCHIVE: join(fixture.dir, 'download.zip'), FIXTURE_ARCHIVE: fixture.archive,
    DOWNLOAD_LOG: join(fixture.dir, 'downloads'),
    EXPECTED_URL: `https://github.com/daijro/camoufox/releases/download/v158.0.1-beta.41/camoufox-158.0.1-beta.41-lin.${arch}.zip`,
  };
  return { result: spawnSync('sh', ['-c', command], { env, encoding: 'utf8' }), env };
}

describe.each(['Dockerfile', 'Dockerfile.ci'])('%s browser assets', name => {
  const source = read(name);

  test('pins the release, both exact archive digests, and the multiarch base', () => {
    expect(source).toContain('ARG CAMOUFOX_VERSION=158.0.1');
    expect(source).toContain('ARG CAMOUFOX_RELEASE=beta.41');
    expect(source).toContain(`ARG CAMOUFOX_SHA256_AMD64=${pins.amd64}`);
    expect(source).toContain(`ARG CAMOUFOX_SHA256_ARM64=${pins.arm64}`);
    expect(source).toMatch(/^FROM node:22-trixie-slim@sha256:[a-f0-9]{64}/m);
    const block = runLine(source, 'CAMOUFOX_RELATIVE=');
    expect(block.indexOf('sha256sum -c -')).toBeLessThan(block.indexOf('unzip -q'));
    expect(block).not.toContain('|| true');
  });

  test('disables implicit lifecycles and explicitly builds native code and fpgen', () => {
    expect(source).toContain('CAMOFOX_SKIP_DOWNLOAD=1 npm ci --omit=dev --ignore-scripts');
    expect(source).toContain('&& npm rebuild better-sqlite3');
    const model = runLine(source, 'ensureModel');
    expect(model).toContain('if [ "${CAMOFOX_SKIP_BROWSER_DOWNLOAD}" != "1" ]');
    expect(model).toContain("from './node_modules/camoufox/dist/pkgman.js'");
    expect(model).toContain("from 'fpgen-js'");
    expect(model).toContain('await ensureModel()');
    expect(source.match(/^CMD .+$/m)[0]).not.toContain('fetch');
  });

  test.each(['amd64', 'arm64'])('installs %s in the layout the real official resolver accepts', target => {
    withFixture(fixture => {
      const { result, env } = executeArchive(source, fixture, target);
      expect(result.status).toBe(0);
      const relative = `browsers/official/158.0.1-beta.41-${fixture.digest.slice(0, 8)}`;
      const installed = join(env.TEST_CACHE, relative);
      expect(JSON.parse(readFileSync(join(installed, 'version.json'), 'utf8'))).toEqual({
        version: '158.0.1', build: 'beta.41', interface: 1, prerelease: false, sha256: fixture.digest,
      });
      expect(JSON.parse(readFileSync(join(env.TEST_CACHE, 'config.json'), 'utf8')).active_version).toBe(relative);
      expect(existsSync(join(env.TEST_CACHE, '.0.5_FLAG'))).toBe(true);
      const resolver = new URL('node_modules/camoufox/dist/pkgman.js', root).href;
      const actual = execFileSync(process.execPath, ['--input-type=module', '-e',
        `import { launchPath } from ${JSON.stringify(resolver)}; console.log(launchPath());`],
      { cwd: root, env, encoding: 'utf8' }).trim();
      expect(actual).toBe(join(installed, 'camoufox-bin'));
      expect(existsSync(join(installed, 'camoufox-bin'))).toBe(true);
      expect(existsSync(env.TEST_ARCHIVE)).toBe(false);
    });
  });

  test('rejects a mismatched archive before extracting or marking the cache compatible', () => {
    withFixture(fixture => {
      const { result, env } = executeArchive(source, fixture, 'amd64', '0'.repeat(64));
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('computed checksum did NOT match');
      expect(existsSync(join(env.TEST_CACHE, '.0.5_FLAG'))).toBe(false);
      expect(existsSync(join(env.TEST_CACHE, 'browsers/official/158.0.1-beta.41-00000000/camoufox-bin'))).toBe(false);
    });
  });

  test('browser-free validation neither downloads nor creates a browser cache', () => {
    withFixture(fixture => {
      const { result, env } = executeArchive(source, fixture, 'arm64', fixture.digest, '1');
      expect(result.status).toBe(0);
      expect(existsSync(env.TEST_CACHE)).toBe(false);
      expect(existsSync(env.DOWNLOAD_LOG)).toBe(false);
    });
  });
});

test.each([['x86_64', 'x86_64', pins.amd64], ['aarch64', 'arm64', pins.arm64]])(
  'Make fetch %s renders exact pinned downloads and verifies retained files', (arch, asset, digest) => {
    const command = execFileSync('make', ['--dry-run', 'fetch', `ARCH=${arch}`], { cwd: root, encoding: 'utf8' });
    expect(command).toContain(`camoufox-158.0.1-beta.41-lin.${asset}.zip`);
    expect(command).toContain(digest);
    expect(command).not.toContain('/latest/');
    expect(command).toContain('sha256sum -c -');
    expect(command).toContain('releases/download/2026.08.19/yt-dlp_linux');
  },
);

test.each([true, false])('Make publishes only verified downloads (checksum matches: %s)', matches => {
  withFixture(fixture => {
    const target = 'dist/camoufox-158.0.1-beta.41-lin.x86_64.zip';
    const result = spawnSync('make', ['-f', fileURLToPath(new URL('Makefile', root)), target,
      'ARCH=x86_64', `CAMOUFOX_SHA256_X86_64=${matches ? fixture.digest : '0'.repeat(64)}`], {
      cwd: fixture.dir, encoding: 'utf8', env: {
        ...process.env, PATH: `${fixture.bin}:${process.env.PATH}`, FIXTURE_ARCHIVE: fixture.archive,
        DOWNLOAD_LOG: join(fixture.dir, 'downloads'),
        EXPECTED_URL: 'https://github.com/daijro/camoufox/releases/download/v158.0.1-beta.41/camoufox-158.0.1-beta.41-lin.x86_64.zip',
      },
    });
    expect(result.status === 0).toBe(matches);
    expect(existsSync(join(fixture.dir, target))).toBe(matches);
    expect(existsSync(join(fixture.dir, `${target}.partial`))).toBe(false);
    if (matches) expect(sha256(readFileSync(join(fixture.dir, target)))).toBe(fixture.digest);
    else expect(result.stderr).toContain('computed checksum did NOT match');
  });
});

test('Make rechecks retained artifacts and refuses corrupt bytes without downloading', () => {
  withFixture(fixture => {
    const dist = join(fixture.dir, 'dist');
    mkdirSync(dist);
    writeFileSync(join(dist, 'camoufox-158.0.1-beta.41-lin.x86_64.zip'), 'corrupt retained archive');
    writeFileSync(join(dist, 'yt-dlp-2026.08.19-x86_64'), 'corrupt retained binary');
    const result = spawnSync('make', ['-f', fileURLToPath(new URL('Makefile', root)), 'fetch', 'ARCH=x86_64'], {
      cwd: fixture.dir, env: { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}` }, encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('computed checksum did NOT match');
    expect(existsSync(join(fixture.dir, 'downloads'))).toBe(false);
  });
});

test('Windows build verifies both new and retained assets and forwards the target digest', () => {
  const source = read('build.ps1');
  for (const pin of Object.values(pins)) expect(source).toContain(pin);
  expect(source).toContain('Get-FileHash -Algorithm SHA256');
  expect(source).toContain('Assert-Checksum $Path $Sha256');
  expect(source).toContain('Assert-Checksum $Partial $Sha256');
  expect(source).toContain('curl.exe --fail --show-error --location');
  expect(source).toContain('--platform "linux/$DockerArch"');
  expect(source).toContain('CAMOUFOX_SHA256_$($DockerArch.ToUpperInvariant())=$CamoufoxSha256');
  expect(source).not.toContain('/latest/');
});
