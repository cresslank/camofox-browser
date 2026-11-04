VERSION  ?= 158.0.1
RELEASE  ?= beta.41
SOURCE_REVISION ?= $(shell git rev-parse --verify HEAD 2>/dev/null)

# Exact archive digests from the v158.0.1-beta.41 GitHub release-tag API.
CAMOUFOX_SHA256_X86_64 ?= 3f2eb1d0451fa58e45e43e55f5e6181565069791ae60c0574f0ceb1f01341c33
CAMOUFOX_SHA256_ARM64 ?= 60e25f6eb95e13d9ec655bc02913d51057e669cb31542e6ace9d2190ab5380af
YT_DLP_VERSION ?= 2026.08.19
YT_DLP_SHA256_X86_64 ?= 58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a
YT_DLP_SHA256_ARM64 ?= b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc

ARCH ?= $(shell uname -m)

# Host aliases, Docker platforms, and upstream filenames use different names.
ifneq (,$(filter $(ARCH),arm64 aarch64))
  CAMOUFOX_ARCH := arm64
  DOCKER_ARCH := arm64
  YTDLP_ARCH := _aarch64
  CAMOUFOX_SHA256 ?= $(CAMOUFOX_SHA256_ARM64)
  YTDLP_SHA256 := $(YT_DLP_SHA256_ARM64)
else ifneq (,$(filter $(ARCH),amd64 x86_64))
  CAMOUFOX_ARCH := x86_64
  DOCKER_ARCH := amd64
  YTDLP_ARCH :=
  CAMOUFOX_SHA256 ?= $(CAMOUFOX_SHA256_X86_64)
  YTDLP_SHA256 := $(YT_DLP_SHA256_X86_64)
else
  $(error Unsupported architecture: $(ARCH))
endif

IMAGE        := camofox-browser:$(VERSION)-$(RELEASE)-$(CAMOUFOX_ARCH)
CAMOUFOX_ZIP := dist/camoufox-$(VERSION)-$(RELEASE)-lin.$(CAMOUFOX_ARCH).zip
YTDLP_BIN    := dist/yt-dlp-$(YT_DLP_VERSION)-$(CAMOUFOX_ARCH)

CAMOUFOX_URL := https://github.com/daijro/camoufox/releases/download/v$(VERSION)-$(RELEASE)/camoufox-$(VERSION)-$(RELEASE)-lin.$(CAMOUFOX_ARCH).zip
YTDLP_URL    := https://github.com/yt-dlp/yt-dlp/releases/download/$(YT_DLP_VERSION)/yt-dlp_linux$(YTDLP_ARCH)

.PHONY: build build-arm64 build-x86 fetch fetch-arm64 fetch-x86 up down reset clean
.DELETE_ON_ERROR:

## Build the Docker image for the current ARCH (default: host architecture)
build: fetch
	@test -n "$(SOURCE_REVISION)" || { echo >&2 "SOURCE_REVISION is required (unable to resolve Git HEAD)"; exit 1; }
	docker build --no-cache --platform=linux/$(DOCKER_ARCH) \
	  --build-arg CAMOUFOX_VERSION=$(VERSION) \
	  --build-arg CAMOUFOX_RELEASE=$(RELEASE) \
	  --build-arg CAMOUFOX_SHA256_AMD64=$(CAMOUFOX_SHA256_X86_64) \
	  --build-arg CAMOUFOX_SHA256_ARM64=$(CAMOUFOX_SHA256_ARM64) \
	  --build-arg SOURCE_REVISION="$(SOURCE_REVISION)" \
	  -t $(IMAGE) .

## Convenience targets
build-arm64:
	$(MAKE) build ARCH=aarch64

build-x86:
	$(MAKE) build ARCH=x86_64

## Download both binaries into dist/ for the current ARCH; reverify retained files.
fetch: $(CAMOUFOX_ZIP) $(YTDLP_BIN)
	printf '%s  %s\n' "$(CAMOUFOX_SHA256)" "$(CAMOUFOX_ZIP)" | sha256sum -c -
	printf '%s  %s\n' "$(YTDLP_SHA256)" "$(YTDLP_BIN)" | sha256sum -c -

fetch-arm64:
	$(MAKE) fetch ARCH=aarch64

fetch-x86:
	$(MAKE) fetch ARCH=x86_64

$(CAMOUFOX_ZIP):
	mkdir -p dist
	set -eu; trap 'rm -f "$@.partial"' EXIT; \
	  curl -fSL "$(CAMOUFOX_URL)" -o "$@.partial"; \
	  printf '%s  %s\n' "$(CAMOUFOX_SHA256)" "$@.partial" | sha256sum -c -; \
	  mv "$@.partial" "$@"

$(YTDLP_BIN):
	mkdir -p dist
	set -eu; trap 'rm -f "$@.partial"' EXIT; \
	  curl -fSL "$(YTDLP_URL)" -o "$@.partial"; \
	  printf '%s  %s\n' "$(YTDLP_SHA256)" "$@.partial" | sha256sum -c -; \
	  mv "$@.partial" "$@"

up:
	@if ! docker image inspect $(IMAGE) > /dev/null 2>&1; then \
	  $(MAKE) build; \
	fi
	docker run -d --restart unless-stopped --name camofox-browser --shm-size=2g -p 9377:9377 $(IMAGE)

down:
	docker stop camofox-browser && docker rm camofox-browser

reset:
	-docker stop camofox-browser 2>/dev/null
	-docker rm camofox-browser 2>/dev/null
	-docker rmi $(IMAGE) 2>/dev/null
	$(MAKE) build

clean:
	rm -rf dist
