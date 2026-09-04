$ErrorActionPreference = "SilentlyContinue"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pidFile = Join-Path $root "storage\.yali-processes.json"
$backendMarker = "--app-dir `"$root\backend`""
$frontendMarker = "$root\frontend\node_modules"
$renderMarker = "$root\render-worker\dist\index.js"

if (Test-Path -LiteralPath $pidFile) {
  $record = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
  foreach ($property in @("backend", "frontend", "render")) {
    $processId = [int]$record.$property
    if ($processId -le 0) { continue }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
    if ($process -and $process.CommandLine -and $process.CommandLine.Contains($root)) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
  }
} else {
  Write-Output "Yali process file was not found; using command-line markers."
}

# WshShell.Run can return 0 for asynchronous commands on some Windows hosts.
# In that case, only terminate processes whose command line contains an exact
# Yali-owned path marker; unrelated Python/Node processes remain untouched.
$ownedProcesses = Get-CimInstance Win32_Process | Where-Object {
  $line = $_.CommandLine
  $line -and (
    $line.Contains($backendMarker) -or
    $line.Contains($frontendMarker) -or
    $line.Contains($renderMarker)
  )
}
foreach ($owned in $ownedProcesses) {
  Stop-Process -Id ([int]$owned.ProcessId) -Force -ErrorAction SilentlyContinue
}

Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
Write-Output "Yali processes stopped."
