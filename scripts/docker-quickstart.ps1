$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Defaults can be overridden by environment variables
$EnvFile = if ($env:ENV_FILE) { $env:ENV_FILE } else { "technitium.env" }
$Image = if ($env:IMAGE) { $env:IMAGE } else { "ghcr.io/fail-safe/technitium-dns-companion:latest" }
$VolumeName = if ($env:VOLUME_NAME) { $env:VOLUME_NAME } else { "technitium-dns-companion-data" }
$HttpPort = if ($env:HTTP_PORT) { $env:HTTP_PORT } else { "3000" }
$HttpsPort = if ($env:HTTPS_PORT) { $env:HTTPS_PORT } else { "3443" }
$NewEnv = $false

function Need-Cmd {
    param([string]$Cmd)
    if (-not (Get-Command $Cmd -ErrorAction SilentlyContinue)) {
        Write-Error "❌ Missing required command: $Cmd" -ErrorAction Stop
    }
}

# Ensure Docker is available and daemon reachable
Need-Cmd -Cmd "docker"
try {
    docker info *> $null
} catch {
    Write-Error "❌ Docker daemon is not running or not accessible. Start Docker and retry." -ErrorAction Stop
}

# Choose download method (Invoke-WebRequest or curl.exe)
$UseIwr = $true
if (-not (Get-Command Invoke-WebRequest -ErrorAction SilentlyContinue)) {
    $UseIwr = $false
}
$CurlPath = Get-Command curl.exe -ErrorAction SilentlyContinue
if (-not $UseIwr -and -not $CurlPath) {
    Write-Error "❌ Neither Invoke-WebRequest nor curl.exe is available. Install one to continue." -ErrorAction Stop
}

# Fetch env template if missing
if (-not (Test-Path -Path $EnvFile)) {
    Write-Host "📥 Downloading .env example to $EnvFile..."
    $Uri = "https://raw.githubusercontent.com/Fail-Safe/Technitium-DNS-Companion/main/.env.example"
    if ($UseIwr) {
        Invoke-WebRequest -Uri $Uri -OutFile $EnvFile
    } else {
        & $CurlPath.Path -fsSL $Uri | Set-Content -Path $EnvFile -Encoding UTF8
    }
    Write-Host "✅ Created $EnvFile. Please edit it with your Technitium node URLs/tokens before continuing."
    $NewEnv = $true
} else {
    Write-Host "ℹ️ Using existing env file: $EnvFile"
}

Write-Host ""
Write-Host "Next steps:"
Write-Host "1) Edit $EnvFile and set TECHNITIUM_NODES plus *_BASE_URL and tokens."
Write-Host "2) After saving your technitium.env file, run:" -NoNewline; Write-Host "`n"
Write-Host "   docker run --rm -p $HttpPort`:3000 -p $HttpsPort`:3443 \"
Write-Host "     --env-file $EnvFile \"
Write-Host "     -v $VolumeName`:/data \"
Write-Host "     $Image`n"

if ($NewEnv) {
    Write-Host "✏️  Edit $EnvFile, then rerun this script to start the container."
    exit 0
}

[void](Read-Host "Press Enter to run it now, or Ctrl+C to cancel.")

Write-Host "🚀 Starting container..."
docker run --rm -p "$HttpPort:3000" -p "$HttpsPort:3443" --env-file "$EnvFile" -v "$VolumeName:/data" "$Image"
