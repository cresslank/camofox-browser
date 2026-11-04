# Firefox origin restoration

Official Camoufox 0.5.9 / Firefox 158 bundles uBlock Origin. Its strict document
blocking can cancel Playwright's intercepted blank-page navigation during
storage-state restoration (observed for `https://tr.snapchat.com`). The error is
`NS_ERROR_ABORT` through native `newContext`, or `NS_BINDING_ABORTED` through
public `page.goto`. It is not a cookie sameSite/expiry migration. Initialization
is asynchronous, so one immediate navigation can pass before blocking starts.

For localStorage-only snapshots, `lib/storage-restore.js` restores the native
cookie/credential state first, then restores origins using eight offline,
intercepted pages. This avoids serial navigation exceeding the service smoke's
30-second create deadline. An origin is skipped only after the exact Firefox
navigation-abort error repeats on a fresh page. Logs contain restored/skipped
counts, never stored values or browser errors. Other failures close the new
context and prevent the server's clean-context/discard fallback from destroying
the saved state. Snapshots containing IndexedDB still use native Playwright
restoration and its existing recovery behavior; this is not a new IndexedDB
serializer. uBlock remains enabled during and after restoration.

The 395-origin field snapshot restored 394 origins in about 13 seconds instead
of failing after more than 100 seconds. Only `tr.snapchat.com` (two localStorage
entries) was consistently blocked; all cookies were accepted (expired cookies
naturally cease appearing). Profile files were not edited during diagnosis.

Run the real synthetic reproduction against an explicitly selected, isolated
Firefox 158 bundle:

```sh
CAMOFOX_STORAGE_TEST_EXECUTABLE=/absolute/path/to/camoufox-bin \
  node --test scripts/test-storage-restore.mjs
```

The test first witnesses the native failure, then verifies healthy localStorage,
cookies, locale, real export/checkpoint, deadline and context cleanup. A real
localStorage quota failure must propagate with the preserve-state marker.
The fixture contains no real cookies or localStorage values. No downloader is
called by this test; provision the paired model/browser assets separately.
