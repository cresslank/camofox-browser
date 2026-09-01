#!/usr/bin/env bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)
revision=${SOURCE_REVISION:-$(git -C "$root" rev-parse --verify HEAD)}
case "$revision" in
  '') echo >&2 'SOURCE_REVISION is required'; exit 1 ;;
esac

context=$(mktemp -d)
prefix="camofox-publication-test-$$"
images=()
cleanup() {
  for image in "${images[@]}"; do
    docker image rm -f "$image" >/dev/null 2>&1 || true
  done
  rm -rf "$context"
}
trap cleanup EXIT

# Export tracked working-tree bytes, not Git metadata or ambient dependencies, then
# add hostile untracked artifacts at every broad COPY boundary.
git -C "$root" ls-files -z | tar -C "$root" --null -T - -cf - | tar -C "$context" -xf -

sentinels=(
  mcp/dist/ambient.js
  mcp/deep/build/ambient.js
  mcp/logs/ambient.json
  mcp/deep/cache/ambient.bin
  mcp/.cache/ambient.bin
  plugins/youtube/deep/dist/ambient.js
  plugins/youtube/logs/ambient.json
  plugins/persistence/deep/.cache/ambient.bin
  docs/deep/.DS_Store
  lib/deep/Thumbs.db
  scripts/deep/Desktop.ini
  plugins/vnc/deep/._ambient
  plugins/vnc/deep/.idea/workspace.xml
  plugins/vnc/deep/.vscode/settings.json
)
for path in "${sentinels[@]}"; do
  mkdir -p "$context/$(dirname "$path")"
  printf 'CAMOFOX_AMBIENT_SENTINEL:%s\n' "$path" >"$context/$path"
done

build_and_inspect() {
  local dockerfile=$1
  local suffix=$2
  local image="$prefix:$suffix"
  images+=("$image")

  docker build \
    --build-arg CAMOFOX_SKIP_BROWSER_DOWNLOAD=1 \
    --build-arg SOURCE_REVISION="$revision" \
    --build-arg TARGETARCH=amd64 \
    -f "$context/$dockerfile" \
    -t "$image" \
    "$context"

  local actual_revision
  actual_revision=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")
  test "$actual_revision" = "$revision"

  docker run --rm --entrypoint sh "$image" -ceu '
    test -f /app/openapi.json
    test -f /app/docs/api.html
    test -f /app/mcp/lib/cookies.mjs
    test -f /app/plugins/persistence/index.js
    for path in \
      mcp/dist/ambient.js \
      mcp/deep/build/ambient.js \
      mcp/logs/ambient.json \
      mcp/deep/cache/ambient.bin \
      mcp/.cache/ambient.bin \
      plugins/youtube/deep/dist/ambient.js \
      plugins/youtube/logs/ambient.json \
      plugins/persistence/deep/.cache/ambient.bin \
      docs/deep/.DS_Store \
      lib/deep/Thumbs.db \
      scripts/deep/Desktop.ini \
      plugins/vnc/deep/._ambient \
      plugins/vnc/deep/.idea/workspace.xml \
      plugins/vnc/deep/.vscode/settings.json
    do
      test ! -e "/app/$path" || { echo >&2 "ambient artifact leaked: /app/$path"; exit 1; }
    done
  '
}

build_and_inspect Dockerfile default
build_and_inspect Dockerfile.ci ci
printf 'Both Docker images excluded %d adversarial ambient sentinels and carried revision %s.\n' \
  "${#sentinels[@]}" "$revision"
