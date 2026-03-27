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

function Stop-PortProcess {
  param(
    [int]$Port,
    [string]$Label
  )

  $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq "Listen" } |
    Select-Object -ExpandProperty OwningProcess -Unique

  if (-not $connections) {
    Write-Host "$Label is not running on port $Port."
    return
  }

  foreach ($processId in $connections) {
    try {
      & taskkill.exe /PID $processId /T /F | Out-Null
      Write-Host "Stopped $Label on port $Port (PID $processId)."

      $childPattern = "parent_pid=$processId"
      $childProcesses = Get-CimInstance Win32_Process |
        Where-Object { $_.CommandLine -and $_.CommandLine -match $childPattern } |
        Select-Object -ExpandProperty ProcessId -Unique

      foreach ($childProcessId in $childProcesses) {
        & taskkill.exe /PID $childProcessId /T /F | Out-Null
        Write-Host "Stopped $Label child process (PID $childProcessId)."
      }
    } catch {
      Write-Warning "Failed to stop $Label on port $Port (PID $processId): $($_.Exception.Message)"
    }
  }
}

function Stop-MatchingProcess {
  param(
    [string]$Label,
    [string]$Pattern
  )

  $matches = Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -and $_.CommandLine -match $Pattern } |
    Select-Object -ExpandProperty ProcessId -Unique

  foreach ($processId in $matches) {
    try {
      & taskkill.exe /PID $processId /T /F | Out-Null
      Write-Host "Stopped $Label process tree (PID $processId)."
    } catch {
      Write-Warning "Failed to stop $Label process tree (PID $processId): $($_.Exception.Message)"
    }
  }
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
$envValues = Read-EnvFile -Paths @(
  (Join-Path $root ".env"),
  (Join-Path $root "apps\api\.env"),
  (Join-Path $root "apps\web\.env"),
  (Join-Path $root "services\transcriber\.env")
)

$apiPort = [int](Get-EnvValue -Values $envValues -Key "API_PORT" -DefaultValue "4000")
$webPort = [int](Get-EnvValue -Values $envValues -Key "WEB_PORT" -DefaultValue "5173")
$transcriberPort = [int](Get-EnvValue -Values $envValues -Key "TRANSCRIBER_PORT" -DefaultValue "8001")

Stop-PortProcess -Port $webPort -Label "web"
Stop-PortProcess -Port $apiPort -Label "api"
Stop-PortProcess -Port $transcriberPort -Label "transcriber"
Stop-MatchingProcess -Label "transcriber" -Pattern "D:\\AIMS\\services\\transcriber|run-logs\\transcriber| -m app\.main"

Write-Host ""
Write-Host "AIMS local test stack has been stopped."
