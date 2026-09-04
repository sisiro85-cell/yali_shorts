$ErrorActionPreference = "SilentlyContinue"

$checks = @(
  @{ Name = "backend"; Url = "http://127.0.0.1:8000/api/health" },
  @{ Name = "render-worker"; Url = "http://127.0.0.1:8010/health" },
  @{ Name = "frontend"; Url = "http://127.0.0.1:5173/" }
)

$results = foreach ($check in $checks) {
  try {
    $response = Invoke-WebRequest -Uri $check.Url -UseBasicParsing -TimeoutSec 3
    [pscustomobject]@{ Service = $check.Name; Status = "ready"; HttpStatus = [int]$response.StatusCode }
  } catch {
    [pscustomobject]@{ Service = $check.Name; Status = "offline"; HttpStatus = $null }
  }
}

$results | Format-Table -AutoSize
if ($results.Status -contains "offline") { exit 1 }
