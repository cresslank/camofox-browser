# Trixie (glibc 2.41), not bookworm (2.36): better-sqlite3 ships an arm64 prebuild
# linked against GLIBC_2.38, so on bookworm it loads and then dies at runtime with
# "version `GLIBC_2.38' not found" the first time a tab is opened. amd64 is
# unaffected because that prebuild targets an older glibc.
FROM node:22-trixie-slim@sha256:2117f713a417f3aff682ac8f5bc2ebbdf1beed51f36e67ab1e0fd3866b6d2d8f AS camofox-browser

# Pinned Camoufox version for reproducible builds
# Update these when upgrading Camoufox
ARG CAMOUFOX_VERSION=158.0.1
ARG CAMOUFOX_RELEASE=beta.41
ARG CAMOUFOX_SHA256_AMD64=3f2eb1d0451fa58e45e43e55f5e6181565069791ae60c0574f0ceb1f01341c33
ARG CAMOUFOX_SHA256_ARM64=60e25f6eb95e13d9ec655bc02913d51057e669cb31542e6ace9d2190ab5380af
ARG TARGETARCH
ARG CAMOFOX_SKIP_BROWSER_DOWNLOAD=0
ARG YT_DLP_VERSION=2026.08.19
ARG YT_DLP_SHA256=1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6

# Install dependencies for Camoufox (Firefox-based)
RUN apt-get update && apt-get install -y \
    # Firefox dependencies
    libgtk-3-0 \
    libdbus-glib-1-2 \
    libxt6 \
    libasound2 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    # Mesa OpenGL/EGL for WebGL support (software rendering via llvmpipe)
    # Without these, Firefox cannot create WebGL contexts -- a major bot detection signal
    # libegl1 -- named libegl1-mesa on bookworm, dropped in trixie
    libegl1 \
    libgl1-mesa-dri \
    libgbm1 \
    # Xvfb virtual display -- runs Camoufox as if on a real desktop (better anti-detection)
    xvfb \
    # Fonts
    fonts-liberation \
    fonts-noto-color-emoji \
    fontconfig \
    # Utils
    ca-certificates \
    curl \
    unzip \
    # yt-dlp runtime dependency
    python3-minimal \
    && rm -rf /var/lib/apt/lists/*

# Exact archive digests: https://api.github.com/repos/daijro/camoufox/releases/tags/v158.0.1-beta.41
# Keep the official launcher's versioned layout; a flat cache without .0.5_FLAG
# is treated as legacy and deleted by camoufox 0.5.x before launch.
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) CAMOUFOX_ARCH="x86_64"; CAMOUFOX_SHA256="${CAMOUFOX_SHA256_AMD64}" ;; \
      arm64) CAMOUFOX_ARCH="arm64"; CAMOUFOX_SHA256="${CAMOUFOX_SHA256_ARM64}" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    if [ "${CAMOFOX_SKIP_BROWSER_DOWNLOAD}" = "1" ]; then \
      echo "Skipping Camoufox download for browser-free image smoke"; \
    else \
      CAMOUFOX_RELATIVE="browsers/official/${CAMOUFOX_VERSION}-${CAMOUFOX_RELEASE}-$(printf '%.8s' "$CAMOUFOX_SHA256")"; \
      CAMOUFOX_DIR="/root/.cache/camoufox/${CAMOUFOX_RELATIVE}"; \
      mkdir -p "$CAMOUFOX_DIR" /root/.camoufox; \
      curl -fSL -o /tmp/camoufox.zip "https://github.com/daijro/camoufox/releases/download/v${CAMOUFOX_VERSION}-${CAMOUFOX_RELEASE}/camoufox-${CAMOUFOX_VERSION}-${CAMOUFOX_RELEASE}-lin.${CAMOUFOX_ARCH}.zip"; \
      printf '%s  %s\n' "$CAMOUFOX_SHA256" /tmp/camoufox.zip | sha256sum -c -; \
      unzip -q /tmp/camoufox.zip -d "$CAMOUFOX_DIR" || [ "$?" -eq 1 ]; \
      test -f "$CAMOUFOX_DIR/camoufox-bin"; \
      printf '{"version":"%s","build":"%s","interface":1,"prerelease":false,"sha256":"%s"}\n' "$CAMOUFOX_VERSION" "$CAMOUFOX_RELEASE" "$CAMOUFOX_SHA256" > "$CAMOUFOX_DIR/version.json"; \
      printf '{"active_version":"%s"}\n' "$CAMOUFOX_RELATIVE" > /root/.cache/camoufox/config.json; \
      touch /root/.cache/camoufox/.0.5_FLAG; \
      chmod -R 755 /root/.cache/camoufox; \
      chmod 700 /root/.camoufox; \
      rm /tmp/camoufox.zip; \
      echo "Camoufox installed successfully"; \
    fi

# yt-dlp is installed and verified by the enabled YouTube plugin hook below.

WORKDIR /app

COPY package.json package-lock.json postinstall.js ./
COPY lib/camoufox-download.js ./lib/camoufox-download.js
COPY scripts/ ./scripts/
# better-sqlite3 has no prebuild matching this node/arch, so npm ci falls back to
# `node-gyp rebuild`, which fails on node:*-slim with "Error: not found: make".
# Install a toolchain for the build and purge it in the same layer so it does not
# land in the image. Independent of the glibc issue noted at the FROM line: this
# one fails at build time on any Debian release, that one at runtime on bookworm.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3 \
    && CAMOFOX_SKIP_DOWNLOAD=1 npm ci --omit=dev --ignore-scripts \
    && npm rebuild better-sqlite3 --ignore-scripts=false \
    && apt-get purge -y --auto-remove build-essential \
    && rm -rf /var/lib/apt/lists/*

# Approved explicit prefetch, not a lifecycle hook or first-launch download.
# Import Camoufox's paths first so fpgen uses the same cache as the launcher;
# fpgen-js verifies its pinned archive AND each member before extraction.
RUN if [ "${CAMOFOX_SKIP_BROWSER_DOWNLOAD}" != "1" ]; then \
      node --input-type=module -e "import { launchPath } from './node_modules/camoufox/dist/pkgman.js'; import { ensureModel } from 'fpgen-js'; launchPath(); await ensureModel();"; \
    fi

COPY server.js ./
COPY camofox.config.json ./
COPY openapi.json ./
COPY docs/ ./docs/
COPY lib/ ./lib/
# lib/cookies.js is a compatibility re-export from ../mcp/lib/cookies.mjs, so mcp/
# must ship even though the MCP server itself is not run here. Without it the
# persistence plugin dies at load with ERR_MODULE_NOT_FOUND, the server starts
# anyway, /health keeps reporting ok, and no profile is ever written -- i.e. the
# container silently loses the durable-profile feature it exists to provide.
COPY mcp/ ./mcp/
COPY plugins/ ./plugins/
COPY scripts/ ./scripts/

# Install default plugin dependencies (apt packages + post-install hooks)
RUN sh scripts/install-plugin-deps.sh

ARG SOURCE_REVISION
RUN test -n "${SOURCE_REVISION}" || (echo >&2 "SOURCE_REVISION is required"; exit 1)
LABEL org.opencontainers.image.revision="${SOURCE_REVISION}"

ENV NODE_ENV=production
ENV CAMOFOX_PORT=9377

EXPOSE 9377

CMD ["sh", "-c", "node --max-old-space-size=${MAX_OLD_SPACE_SIZE:-128} server.js"]

# Optional: rebuild plugin deps after adding third-party plugins
# Usage: docker build --target with-plugins -t camofox-browser .
FROM camofox-browser AS with-plugins
COPY plugins/ ./plugins/
COPY camofox.config.json ./
COPY openapi.json ./
COPY docs/ ./docs/
COPY scripts/install-plugin-deps.sh /tmp/install-plugin-deps.sh
RUN /tmp/install-plugin-deps.sh && rm /tmp/install-plugin-deps.sh
