$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Defaults can be overridden by environment variables
$EnvFile = if ($env:ENV_FILE) { $env:ENV_FILE } else { "technitium.env" }
$Image = if ($env:IMAGE) { $env:IMAGE } else { "ghcr.io/fail-safe/technitium-dns-companion:latest" }
$VolumeName = if ($env:VOLUME_NAME) { $env:VOLUME_NAME } else { "technitium-dns-companion-data" }
$HttpPort = if ($env:HTTP_PORT) { $env:HTTP_PORT } else { "3000" }
$HttpsPort = if ($env:HTTPS_PORT) { $env:HTTPS_PORT } else { "3443" }
$NewEnv = $false

function Prompt-Port {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Default
    )

    while ($true) {
        $input = Read-Host "${Label} port [$Default]"
        if ([string]::IsNullOrWhiteSpace($input)) {
            return $Default
        }

        $port = 0
        if (-not [int]::TryParse($input, [ref]$port)) {
            Write-Host "❌ Invalid port: $input (must be 1-65535)" -ForegroundColor Red
            continue
        }

        if ($port -lt 1 -or $port -gt 65535) {
            Write-Host "❌ Invalid port: $input (must be 1-65535)" -ForegroundColor Red
            continue
        }

        return $port.ToString()
    }
}

function Need-Cmd {
    param([string]$Cmd)
    if (-not (Get-Command $Cmd -ErrorAction SilentlyContinue)) {
        Write-Error "❌ Missing required command: $Cmd" -ErrorAction Stop
    }
}

# Obligatory newline for readability
Write-Host ""

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
if ($NewEnv) {
    Write-Host "Next steps:"
    Write-Host "1) Edit $EnvFile and set TECHNITIUM_NODES plus *_BASE_URL and tokens."
    Write-Host "2) After saving your technitium.env file, rerun this script."
    exit 0
}

# Confirm ports (Enter keeps defaults)
Write-Host "Port configuration (press Enter to accept defaults):"
$HttpPort = Prompt-Port -Label "HTTP" -Default $HttpPort

while ($true) {
    $HttpsPort = Prompt-Port -Label "HTTPS" -Default $HttpsPort
    if ($HttpsPort -ne $HttpPort) {
        break
    }

    Write-Host "❌ HTTPS port must be different from HTTP port ($HttpPort)." -ForegroundColor Red
}

Write-Host ""
Write-Host "Next step:" -NoNewline; Write-Host "`n"
Write-Host "   docker run --rm -p $HttpPort`:3000 -p $HttpsPort`:3443 \"
Write-Host "     --env-file $EnvFile \"
Write-Host "     -v $VolumeName`:/data \"
Write-Host "     $Image`n"

Write-Host 'Press Enter to execute "docker run" now (any other key cancels).'

$enterPressed = $false

try {
    # Prefer RawUI (works across Windows Terminal/iTerm/etc and supports NoEcho).
    while ($Host.UI.RawUI.KeyAvailable) {
        $null = $Host.UI.RawUI.ReadKey([System.Management.Automation.Host.ReadKeyOptions]::NoEcho -bor [System.Management.Automation.Host.ReadKeyOptions]::IncludeKeyDown)
    }

    $k = $Host.UI.RawUI.ReadKey([System.Management.Automation.Host.ReadKeyOptions]::NoEcho -bor [System.Management.Automation.Host.ReadKeyOptions]::IncludeKeyDown)
    $enterPressed = ($k.VirtualKeyCode -eq 13) -or ($k.Character -eq "`r") -or ($k.Character -eq "`n")
} catch {
    try {
        # Fallback: Console.ReadKey
        while ([Console]::KeyAvailable) {
            [Console]::ReadKey($true) | Out-Null
        }

        $key = [Console]::ReadKey($true)
        $enterPressed = ($key.Key -eq [ConsoleKey]::Enter) -or ($key.KeyChar -eq [char]13) -or ($key.KeyChar -eq [char]10)
    } catch {
        # Last resort: line input. (Not strictly "any other key" but better than crashing.)
        $line = Read-Host
        $enterPressed = [string]::IsNullOrEmpty($line)
    }
}

Write-Host ""
if (-not $enterPressed) {
    Write-Host "Cancelled."
    exit 0
}

Write-Host "📀 Pulling image: $Image"
try {
    & docker pull "$Image" *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "docker pull failed"
    }
} catch {
    Write-Host "⚠️  Could not pull image (continuing). If this is a local image name, this is expected." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🚀 Starting container..."
docker run --rm -p "${HttpPort}:3000" -p "${HttpsPort}:3443" --env-file "$EnvFile" -v "${VolumeName}:/data" "$Image"
