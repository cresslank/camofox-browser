#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Build and manage camofox-browser on Windows (PowerShell alternative to Makefile).

.DESCRIPTION
    Provides the same targets as the Makefile for Windows users without make:
      build   - Download Camoufox + yt-dlp, then build the Docker image.
      up      - Build (if needed) and run the container.
      down    - Stop and remove the container.
      reset   - Full rebuild from scratch.
      clean   - Remove downloaded binaries.
      fetch   - Download Camoufox + yt-dlp binaries only.

.PARAMETER Target
    The action to perform: build, up, down, reset, clean, fetch (default: build).

.PARAMETER Arch
    Target architecture: x86_64 or aarch64 (default: x86_64).

.PARAMETER CamoufoxVersion
    Camoufox version (default: 158.0.1).

.PARAMETER CamoufoxRelease
    Camoufox release channel (default: beta.41).

.PARAMETER ContainerName
    Docker container name (default: camofox-browser).

.PARAMETER HostPort
    Host port to map (default: 9377).

.EXAMPLE
    .\build.ps1 up          # Build + run
    .\build.ps1 down        # Stop container
    .\build.ps1 fetch       # Download binaries only
#>

param(
    [ValidateSet('build', 'up', 'down', 'reset', 'clean', 'fetch')]
    [string]$Target = 'build',

    [ValidateSet('x86_64', 'aarch64')]
    [string]$Arch = 'x86_64',

    [string]$CamoufoxVersion = '158.0.1',
    [string]$CamoufoxRelease = 'beta.41',
    [string]$CamoufoxSha256 = '',
    [string]$YtDlpVersion = '2026.08.19',
    [string]$YtDlpSha256 = '',
    [string]$ContainerName = 'camofox-browser',
    [int]$HostPort = 9377
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSCommandPath
$DistDir = Join-Path $ProjectRoot 'dist'
$ContainerPort = 9377
$SourceRevision = (& git -C $ProjectRoot rev-parse --verify 'HEAD^{commit}').Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($SourceRevision)) {
    throw 'Unable to resolve SOURCE_REVISION from Git HEAD.'
}

# Map architecture to upstream release filenames
if ($Arch -eq 'aarch64') {
    $CamoufoxArch = 'arm64'
    $DockerArch = 'arm64'
    $YtDlpSuffix = '_aarch64'
    $PinnedCamoufoxSha256 = '60e25f6eb95e13d9ec655bc02913d51057e669cb31542e6ace9d2190ab5380af'
    $PinnedYtDlpSha256 = 'b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc'
} else {
    $CamoufoxArch = 'x86_64'
    $DockerArch = 'amd64'
    $YtDlpSuffix = ''
    $PinnedCamoufoxSha256 = '3f2eb1d0451fa58e45e43e55f5e6181565069791ae60c0574f0ceb1f01341c33'
    $PinnedYtDlpSha256 = '58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a'
}

# Archive pins: https://api.github.com/repos/daijro/camoufox/releases/tags/v158.0.1-beta.41
if (-not $CamoufoxSha256) { $CamoufoxSha256 = $PinnedCamoufoxSha256 }
if (-not $YtDlpSha256) { $YtDlpSha256 = $PinnedYtDlpSha256 }
$CamoufoxZip = Join-Path $DistDir "camoufox-$CamoufoxVersion-$CamoufoxRelease-lin.$CamoufoxArch.zip"
$YtDlpBin = Join-Path $DistDir "yt-dlp-$YtDlpVersion-$CamoufoxArch"
$ImageTag = "camofox-browser:$CamoufoxVersion-$CamoufoxRelease-$CamoufoxArch"

$CamoufoxUrl = "https://github.com/daijro/camoufox/releases/download/v$CamoufoxVersion-$CamoufoxRelease/camoufox-$CamoufoxVersion-$CamoufoxRelease-lin.$CamoufoxArch.zip"
$YtDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/download/$YtDlpVersion/yt-dlp_linux$YtDlpSuffix"

function Write-Step {
    param([string]$Message)
    Write-Host ">>> $Message" -ForegroundColor Cyan
}

function Assert-Checksum {
    param([string]$Path, [string]$Sha256)
    if ($Sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw "Invalid SHA256 for $Path" }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash -ne $Sha256) {
        throw "SHA256 mismatch for $Path"
    }
}

function Get-VerifiedDownload {
    param([string]$Url, [string]$Path, [string]$Sha256)
    if (Test-Path -LiteralPath $Path) {
        Assert-Checksum $Path $Sha256
        Write-Host "  [VERIFIED] $Path"
        return
    }
    $Partial = "$Path.partial"
    try {
        Write-Step "Downloading $Url"
        curl.exe --fail --show-error --location --output $Partial $Url
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url (exit $LASTEXITCODE)" }
        Assert-Checksum $Partial $Sha256
        Move-Item -LiteralPath $Partial -Destination $Path
    } finally {
        if (Test-Path -LiteralPath $Partial) { Remove-Item -LiteralPath $Partial -Force }
    }
}

function Invoke-Fetch {
    New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
    Get-VerifiedDownload $CamoufoxUrl $CamoufoxZip $CamoufoxSha256
    Get-VerifiedDownload $YtDlpUrl $YtDlpBin $YtDlpSha256
}

function Invoke-Build {
    Invoke-Fetch

    Write-Step "Building Docker image: $ImageTag"
    docker build `
        --platform "linux/$DockerArch" `
        --build-arg "CAMOUFOX_VERSION=$CamoufoxVersion" `
        --build-arg "CAMOUFOX_RELEASE=$CamoufoxRelease" `
        --build-arg "CAMOUFOX_SHA256_$($DockerArch.ToUpperInvariant())=$CamoufoxSha256" `
        --build-arg "SOURCE_REVISION=$SourceRevision" `
        -t $ImageTag `
        -f (Join-Path $ProjectRoot 'Dockerfile') `
        $ProjectRoot
    if ($LASTEXITCODE -ne 0) { throw "Docker build failed (exit $LASTEXITCODE)" }
}

function Invoke-Up {
    # Check if image exists
    $imageExists = docker images -q $ImageTag 2>$null
    if (-not $imageExists) {
        Write-Step "Image not found — building first..."
        Invoke-Build
    }

    # Stop & remove existing container
    docker stop $ContainerName 2>$null | Out-Null
    docker rm $ContainerName 2>$null | Out-Null

    Write-Step "Starting container: $ContainerName on port $HostPort"
    docker run -d `
        --restart unless-stopped `
        --name $ContainerName `
        -p "${HostPort}:${ContainerPort}" `
        $ImageTag

    Write-Host "Container started. Server should be available at http://localhost:$HostPort" -ForegroundColor Green
    Write-Host "Check logs: docker logs $ContainerName" -ForegroundColor Gray
}

function Invoke-Down {
    Write-Step "Stopping container: $ContainerName"
    docker stop $ContainerName 2>$null
    docker rm $ContainerName 2>$null
    Write-Host "Container stopped and removed." -ForegroundColor Green
}

function Invoke-Reset {
    Invoke-Down

    Write-Step "Removing Docker image: $ImageTag"
    docker rmi $ImageTag 2>$null

    Invoke-Build
    Invoke-Up
}

function Invoke-Clean {
    Write-Step "Removing dist directory..."
    if (Test-Path $DistDir) {
        Remove-Item -Recurse -Force $DistDir
        Write-Host "Removed: $DistDir" -ForegroundColor Green
    } else {
        Write-Host "Nothing to clean." -ForegroundColor Yellow
    }
}

# --- Main dispatch ---
switch ($Target) {
    'build'  { Invoke-Build }
    'up'     { Invoke-Up }
    'down'   { Invoke-Down }
    'reset'  { Invoke-Reset }
    'clean'  { Invoke-Clean }
    'fetch'  { Invoke-Fetch }
}
