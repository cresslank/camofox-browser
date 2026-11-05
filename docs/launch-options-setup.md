# Official launch-options cold-start budget

`camoufox@0.5.9`'s `launchOptions()` is not just GeoIP configuration. For the
host's own OS it launches a temporary Firefox through `hostGpu()` to read the
native renderer, closes that browser, then assembles the final fingerprint.
Model verification, addon discovery and locale configuration run here too.

The former ten-second `GeoIP setup` deadline wrapped **all** of this work,
including direct launches with `geoip: false`. On kmac the first service
adoption reached a real Firefox process during this stage but hit that deadline
before options completed. There was no proxy and no public-IP/GeoIP request.
Power logs show the Mac was awake, not a sleep/wake transition. Native repeat
measurements put the GPU subprocess at about 4.2 seconds; the historical logs
cannot attribute every millisecond of its slower initial run.

Allow thirty seconds for complete options assembly, name that timeout accurately,
and keep the enclosing sixty-second launch fence. Only actual GeoIP errors may
fall back without GeoIP: an options deadline is not evidence of a GeoIP failure
and must not launch a duplicate options/GPU attempt.

Native regression (prepared official bundle and model required):

```sh
CAMOFOX_STORAGE_TEST_EXECUTABLE=/absolute/path/to/qualified/camoufox \
  node --test scripts/test-launch-options-setup.mjs
```

Use the same isolated official HOME/XDG cache as the service. Optionally set
`CAMOFOX_LAUNCH_TEST_PROFILE` to a **scratch copy** of a saved storage-state file.
The test creates a loopback fixture and disposable server/profile, delays the
real native GPU probe by eleven seconds, rejects unexpected GeoIP lookups, then
checks real create/snapshot/close HTTP requests. It never prints storage values.
Restoring the old ten-second deadline makes its tab-create success assertion
fail with HTTP 500; thirty seconds passes on Linux and macOS. The injected delay
is a deterministic regression witness, not a measurement of the historical
slowdown. No controller idle/restart/rollback policy changes are needed.
