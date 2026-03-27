$ErrorActionPreference = "Stop"

function Read-EnvFile {
  param([string[]]$Paths)

  $values = @{}
  foreach ($path in $Paths) {
    if (-not (Test-Path $path)) {
      continue
    }

    foreach ($rawLine in Get-Content $path) {
      $line = $rawLine.Trim()
      if (-not $line -or $line.StartsWith("#")) {
        continue
      }

      $equalsIndex = $line.IndexOf("=")
      if ($equalsIndex -lt 1) {
        continue
      }

      $key = $line.Substring(0, $equalsIndex).Trim()
      $value = $line.Substring($equalsIndex + 1).Trim().Trim("'`"")
      $values[$key] = $value
    }
  }

  return $values
}

function Test-UrlOk {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
  } catch {
    return $false
  }
}

function Wait-ForUrl {
  param(
    [string]$Url,
    [string]$Label,
    [int]$TimeoutSeconds = 120
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-UrlOk -Url $Url) {
      Write-Host "$Label is ready at $Url"
      return
    }
    Start-Sleep -Seconds 2
  }

  throw "$Label did not become ready at $Url within $TimeoutSeconds seconds."
}

function Test-PortOpen {
  param(
    [string]$TargetHost,
    [int]$Port
  )

  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $async = $client.BeginConnect($TargetHost, $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(1500, $false)) {
      $client.Close()
      return $false
    }
    $client.EndConnect($async)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Start-LoggedProcess {
  param(
    [string]$Label,
    [string]$WorkingDirectory,
    [string]$Command,
    [string]$LogPath
  )

  Write-Host "Starting $Label..."
  $cmd = "cd /d `"$WorkingDirectory`" && $Command > `"$LogPath`" 2>&1"
  Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/c", $cmd) -WindowStyle Hidden | Out-Null
}

function Get-EnvValue {
  param(
    [hashtable]$Values,
    [string]$Key,
    [string]$DefaultValue
  )

  if ($Values.ContainsKey($Key) -and $Values[$Key]) {
    return $Values[$Key]
  }

  return $DefaultValue
}

$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root "run-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$envValues = Read-EnvFile -Paths @(
  (Join-Path $root ".env"),
  (Join-Path $root "apps\api\.env"),
  (Join-Path $root "apps\web\.env"),
  (Join-Path $root "services\transcriber\.env")
)

$apiPort = [int](Get-EnvValue -Values $envValues -Key "API_PORT" -DefaultValue "4000")
$webPort = [int](Get-EnvValue -Values $envValues -Key "WEB_PORT" -DefaultValue "5173")
$transcriberPort = [int](Get-EnvValue -Values $envValues -Key "TRANSCRIBER_PORT" -DefaultValue "8001")
$redisHost = Get-EnvValue -Values $envValues -Key "REDIS_HOST" -DefaultValue "127.0.0.1"
$redisPort = [int](Get-EnvValue -Values $envValues -Key "REDIS_PORT" -DefaultValue "6379")
$apiBaseUrl = $envValues["API_BASE_URL"]
if (-not $apiBaseUrl) {
  $apiBaseUrl = "http://127.0.0.1:$apiPort"
}
$transcriberBaseUrl = $envValues["TRANSCRIBER_BASE_URL"]
if (-not $transcriberBaseUrl) {
  $transcriberBaseUrl = $envValues["TRANSCRIBER_URL"]
}
if (-not $transcriberBaseUrl) {
  $transcriberBaseUrl = "http://127.0.0.1:$transcriberPort"
}
$webUrl = "http://localhost:$webPort/upload"

if (-not $envValues["MONGODB_URI"]) {
  throw "MONGODB_URI is missing. Fill in .env or apps/api/.env first."
}

if (-not (Test-PortOpen -TargetHost $redisHost -Port $redisPort)) {
  throw "Redis is not reachable at ${redisHost}:$redisPort. Start Redis first, then retry."
}

$transcriberVenv = Join-Path $root "services\transcriber\.venv\Scripts\python.exe"
if (-not (Test-Path $transcriberVenv)) {
  throw "Transcriber virtual environment was not found at $transcriberVenv."
}

if (-not (Test-UrlOk -Url "$transcriberBaseUrl/health")) {
  Start-LoggedProcess -Label "transcriber" -WorkingDirectory $root -Command "set PYTHON_ENV=production && npm run dev:transcriber" -LogPath (Join-Path $logDir "transcriber-live.log")
  Wait-ForUrl -Url "$transcriberBaseUrl/health" -Label "Transcriber"
} else {
  Write-Host "Transcriber already running."
}

if (-not (Test-UrlOk -Url "$apiBaseUrl/api/health")) {
  Start-LoggedProcess -Label "api" -WorkingDirectory $root -Command "npm run dev:api" -LogPath (Join-Path $logDir "api-live.log")
  Wait-ForUrl -Url "$apiBaseUrl/api/health" -Label "API"
} else {
  Write-Host "API already running."
}

if (-not (Test-UrlOk -Url $webUrl)) {
  Start-LoggedProcess -Label "web" -WorkingDirectory $root -Command "npm run dev:web" -LogPath (Join-Path $logDir "web-live.log")
  Wait-ForUrl -Url $webUrl -Label "Web"
} else {
  Write-Host "Web app already running."
}

Start-Process $webUrl | Out-Null
Write-Host ""
Write-Host "AIMS local test stack is ready."
Write-Host "Upload page: $webUrl"
Write-Host "Logs: $logDir"
