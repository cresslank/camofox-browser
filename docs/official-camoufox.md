# Official Camoufox runtime

This is a source candidate, not a deployment. The qualified cohort is exactly
`camoufox@0.5.9`, `playwright-core@1.62.0`, and browser `158.0.1-beta.41`.
Node must be at least 22.15; local qualification uses Node 22.23.4.

## Explicit preparation

Install with lifecycle scripts disabled, audit the locked closure, then build
only the reviewed SQLite binding. In the managed environment:

```sh
fnm exec --using=22.23.4 sfw npm ci --ignore-scripts
fnm exec --using=22.23.4 sfw npm ci --prefix mcp --ignore-scripts
fnm exec --using=22.23.4 sfw npm audit --omit=dev
fnm exec --using=22.23.4 sfw npm audit --prefix mcp --omit=dev
fnm exec --using=22.23.4 sfw npm audit signatures --omit=dev
fnm exec --using=22.23.4 sfw npm rebuild better-sqlite3 --ignore-scripts=false
```

Choose a **new private cache**, not a deployed camoufox-js cache, before fetching.
On Linux a separate `XDG_CACHE_HOME` suffices; on macOS use an isolated HOME
because the official cache ignores XDG there. Isolate HOME and temporary/state
locations as well when qualifying a candidate.

```sh
fnm exec --using=22.23.4 node lib/camoufox-download.js
```

This is `npm run fetch-bin` without a package-manager subprocess. It checks for a
legacy cache before invoking the installed official CLI with `set --release`
and then `fetch`. The equivalent raw CLI is:

```sh
node node_modules/camoufox/dist/__main__.js set --release
node node_modules/camoufox/dist/__main__.js fetch
```

**Do not run the raw CLI or official path helpers against a legacy cache.** They
recursively delete a nonempty cache without `.0.5_FLAG`. Camofox's fetch wrapper
refuses it, leaving it unchanged. Its bundled launch preflight checks the marker,
selected build and prefetched fingerprint model before calling the launcher.
Missing browser/model assets fail closed instead of being installed on startup.
Postinstall remains warning-only; explicit `fetch-bin` failures are nonzero.

MCP package-smoke commands use portable npm by default; the hardened harness
sets `CAMOFOX_TEST_USE_SFW=1` to route every nested pack/install through Socket
Firewall without making it a prerequisite for upstream contributors.

## Paths, configuration and writes

- Linux cache root: `$XDG_CACHE_HOME/camoufox`, otherwise `~/.cache/camoufox`.
- macOS root: `~/Library/Caches/camoufox`.
- Browser install: `<root>/browsers/official/158.0.1-beta.41[-sha8]/`.
  The qualified Linux x86_64 directory ends in `-3f2eb1d0`; arm64 in `-60e25f6e`.
- Executable: `<install>/camoufox-bin` on Linux;
  `<install>/Camoufox.app/Contents/MacOS/camoufox` on macOS.
- Metadata: `<install>/version.json` on **both** platforms, not the cache root.
  Selection is `<root>/config.json`; compatibility marker is `<root>/.0.5_FLAG`.
- Fingerprint model: `<root>/fpgen/`, overridden by `CAMOUFOX_FPGEN_DATA`.
  Camoufox sets fpgen's model directory itself, so `FPGEN_DATA_DIR` alone does not
  override Camoufox's selected directory. `.pinned-model` and pinned members must
  exist before startup.
- `CAMOUFOX_CACHE_DIR` and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` are **not** official
  downloader controls. `CAMOFOX_SKIP_DOWNLOAD=1` or `true` skips Camofox's install
  hook only. `--ignore-scripts` disables all install lifecycle hooks.
- Camofox's external executable precedence remains `CAMOUFOX_EXECUTABLE`, then
  `CAMOUFOX_EXECUTABLE_PATH`, then `CAMOFOX_EXECUTABLE_PATH`. Official launchOptions
  also honors `CAMOUFOX_EXECUTABLE_PATH`. Use complete compatible bundles;
  application.ini determines the actual UA version. macOS bundles are not mutated.
- Fetch writes browser files, version metadata, selection/marker, GeoIP database
  and pinned fpgen data. Proxied GeoIP setup can still fetch or refresh MMDB
  when absent/stale; Docker preparation prefetches the model but not MMDB.
  Browser launch writes `<root>/fontconfig/` and may write
  the official `~/.camoufox` profile directory. Playwright profiles and Xvfb files
  live under the configured temporary directory. External non-macOS bundles may
  use Camofox's temporary resource-link shim, not a flat-cache compatibility copy.
- Camofox's existing state remains profiles under `~/.camofox/profiles/` (or
  `CAMOFOX_PROFILE_DIR`), cookies (`CAMOFOX_COOKIES_DIR`), uploads/downloads,
  and traces (`CAMOFOX_TRACES_DIR`); isolate all of them for qualification.

The managed service preflight/updater, macOS launcher and maintenance controller
must separately adopt this cohort and versioned cache. In particular, the
controller's camoufox-js equality and flat-binary identity checks deliberately do
not admit this migration. This PR changes none of those deployment sources or
receipts. Linux qualification does not replace macOS qualification.

## Qualification observations

The non-E2E selection covers unit, plugin and script tests. Browser-dependent
unit tests and the dedicated E2E selection run against the real paired browser.
Windows-specific tests are skipped on Linux, not counted as passes. Popup
creation via evaluate needs `dom.disable_open_during_load=false` with Firefox
158; the existing managed-popup lifecycle assertion remains intact. E2E's
stalled-navigation fixture uses an explicit 10 second server deadline so it tests
server timeout handling before Firefox's independent stalled-channel abort.

Public smoke: example.com currently has title `Example Domain`, but its body has
no heading containing that phrase. Its accessibility snapshot contains the real
multilingual documentation notice, not the title. Qualification checks the
current body plus the separately evaluated title; it does not inject page content
or change the snapshot API to manufacture the former heading. Viewport resize,
`navigator.webdriver === false`, and Linux/Firefox 158 UA/platform/OS coherence
are checked on a public JavaScript test page.

Production audits are clean at qualification. The complete root audit reports
five low development-only entries from `deepmerge` GHSA-gcqx-w48m-w2h4 through
Jest. They are not hidden by a production-only audit or a Jest downgrade.

## Lock delta publication gate

Registry metadata was checked before commit. Every introduced or changed lock
entry below has matching registry `dist.tarball` and `dist.integrity`, and was at
least 24 hours old. Only five entries change package/version identity: camoufox,
its yaml dependency, fpgen-js, python-random, and playwright-core. Other rows are
hoisting/dev-optional flag changes, not version refreshes. The MCP lock is unchanged.

| Lock path (under node_modules/) | Version | Registry publication (UTC) | Age at verification (hours) |
| --- | --- | --- | ---: |
| `@isaacs/nonrecursive-glob-match` | 1.0.3 | 2026-10-28T19:50:48.349Z | 147.61 |
| `@openclaw/fs-safe-linux-arm64-gnu` | 0.8.5 | 2026-09-07T09:45:24.162Z | 1381.7 |
| `@openclaw/fs-safe-linux-arm64-musl` | 0.8.5 | 2026-09-07T09:45:38.691Z | 1381.69 |
| `@openclaw/fs-safe-linux-x64-gnu` | 0.8.5 | 2026-09-07T09:42:58.118Z | 1381.74 |
| `@openclaw/fs-safe-linux-x64-musl` | 0.8.5 | 2026-09-07T09:43:16.952Z | 1381.73 |
| `@trycua/cua-driver-linux-arm64-gnu` | 0.22.2 | 2026-08-27T18:48:20.362Z | 1636.65 |
| `@trycua/cua-driver-linux-x64-gnu` | 0.22.2 | 2026-08-27T18:48:26.808Z | 1636.65 |
| `@ubjs/node-linux-arm64-gnu` | 0.31.0-3 | 2026-05-28T11:51:33.581Z | 3827.59 |
| `@ubjs/node-linux-arm64-musl` | 0.31.0-3 | 2026-05-28T11:51:37.814Z | 3827.59 |
| `@ubjs/node-linux-x64-gnu` | 0.31.0-3 | 2026-05-28T11:51:41.029Z | 3827.59 |
| `@ubjs/node-linux-x64-musl` | 0.31.0-3 | 2026-05-28T11:51:44.070Z | 3827.59 |
| `balanced-match` | 4.0.4 | 2026-02-22T11:38:25.951Z | 6107.81 |
| `baseline-browser-mapping` | 2.11.22 | 2026-09-10T17:35:37.378Z | 1301.86 |
| `brace-expansion` | 5.0.12 | 2026-09-14T21:59:00.288Z | 1201.47 |
| `browserslist` | 4.28.9 | 2026-09-04T13:39:02.361Z | 1449.8 |
| `callsites` | 3.1.0 | 2019-04-06T11:57:30.657Z | 66443.49 |
| `camoufox` | 0.5.9 | 2026-11-01T06:23:39.269Z | 65.06 |
| `camoufox/node_modules/yaml` | 2.9.1 | 2026-09-11T20:30:10.905Z | 1274.95 |
| `caniuse-lite` | 1.0.30001810 | 2026-08-24T20:04:16.328Z | 1707.38 |
| `electron-to-chromium` | 1.5.427 | 2026-09-10T22:04:17.668Z | 1297.38 |
| `escalade` | 3.2.0 | 2024-08-29T22:59:36.690Z | 19104.46 |
| `fpgen-js` | 1.3.0 | 2026-10-09T17:05:26.069Z | 606.36 |
| `glob` | 14.0.3 | 2026-10-28T04:08:39.624Z | 163.31 |
| `minimatch` | 11.0.3 | 2026-10-28T20:00:34.713Z | 147.44 |
| `minipass` | 7.1.3 | 2026-02-19T00:34:33.886Z | 6190.88 |
| `node-releases` | 2.0.55 | 2026-09-09T08:06:57.970Z | 1335.34 |
| `path-scurry` | 3.0.0 | 2026-10-27T21:14:48.842Z | 170.21 |
| `path-scurry/node_modules/lru-cache` | 11.5.3 | 2026-09-18T23:46:33.023Z | 1103.68 |
| `picocolors` | 1.1.1 | 2024-10-16T18:20:03.921Z | 17957.12 |
| `playwright-core` | 1.62.0 | 2026-07-24T21:56:56.822Z | 2449.5 |
| `python-random` | 1.0.0 | 2026-10-09T17:06:59.739Z | 606.34 |
| `tslib` | 2.8.1 | 2024-10-31T22:42:48.624Z | 17592.74 |
| `update-browserslist-db` | 1.3.3 | 2026-09-10T17:39:26.423Z | 1301.8 |
