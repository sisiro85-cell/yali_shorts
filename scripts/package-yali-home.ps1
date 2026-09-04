param(
  [string]$OutputPath = "",
  [switch]$SkipStopServices
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$releaseExe = Join-Path $root "release\YaliShortformStudio.exe"
$frontendModules = Join-Path $root "frontend\node_modules"
$renderModules = Join-Path $root "render-worker\node_modules"
$renderDist = Join-Path $root "render-worker\dist\index.js"
$basePythonConfig = Get-Content (Join-Path $root ".venv\pyvenv.cfg") -ErrorAction SilentlyContinue |
  Where-Object { $_ -match "^home\s*=" } |
  Select-Object -First 1
$basePython = if ($basePythonConfig) { $basePythonConfig -replace "^home\s*=\s*", "" } else { $null }
$nodeHome = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
$nodeHome = if ($nodeHome) { Split-Path $nodeHome -Parent } else { $null }

if (-not $OutputPath) {
  $OutputPath = Join-Path $root ("release\YaliShortformStudio-home-{0}.zip" -f (Get-Date -Format "yyyyMMdd"))
}
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$stage = Join-Path $root ".build\portable-home"

function Copy-Tree([string]$Source, [string]$Destination, [string[]]$ExcludedDirectories = @(), [string[]]$ExcludedFiles = @()) {
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "포함할 폴더를 찾을 수 없습니다: $Source"
  }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $arguments = @($Source, $Destination, "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
  foreach ($directory in $ExcludedDirectories) { $arguments += @("/XD", (Join-Path $Source $directory)) }
  foreach ($file in $ExcludedFiles) { $arguments += @("/XF", $file) }
  & robocopy @arguments | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "폴더 복사에 실패했습니다: $Source (robocopy $LASTEXITCODE)" }
}

function Copy-FileChecked([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "포함할 파일을 찾을 수 없습니다: $Source" }
  $parent = Split-Path $Destination -Parent
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

if (-not (Test-Path -LiteralPath $releaseExe -PathType Leaf)) {
  & (Join-Path $root "scripts\build-yali-exe.ps1")
}
foreach ($required in @($frontendModules, $renderModules, $renderDist, $basePython, $nodeHome)) {
  if (-not $required -or -not (Test-Path -LiteralPath $required)) {
    throw "포터블 번들에 필요한 실행 구성요소가 없습니다: $required"
  }
}

$wasRunning = $false
if (-not $SkipStopServices) {
  $status = & (Join-Path $root "scripts\check-yali.ps1") 2>$null | Out-String
  $wasRunning = $status -match "ready"
  if ($wasRunning) { & (Join-Path $root "scripts\stop-yali.ps1") | Out-Null }
}

try {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $stage | Out-Null

  Copy-Tree (Join-Path $root "backend") (Join-Path $stage "backend") @("__pycache__")
  Copy-Tree (Join-Path $root "frontend") (Join-Path $stage "frontend") @("test-results") @("tsconfig.tsbuildinfo")
  Copy-Tree (Join-Path $root "render-worker") (Join-Path $stage "render-worker") @("test-results") @("tsconfig.tsbuildinfo")
  Copy-Tree (Join-Path $root "scripts") (Join-Path $stage "scripts") @("__pycache__")
  foreach ($directory in @("docs", "design-system")) {
    if (Test-Path -LiteralPath (Join-Path $root $directory)) {
      Copy-Tree (Join-Path $root $directory) (Join-Path $stage $directory) @("__pycache__")
    }
  }

  foreach ($file in @(".gitattributes", ".gitignore", "README.md", "pyproject.toml", "uv.lock")) {
    Copy-FileChecked (Join-Path $root $file) (Join-Path $stage $file)
  }

  # Keep the application data so the current project and generated previews
  # are available at home, but never carry machine-specific locks or PIDs.
  Copy-Tree (Join-Path $root "storage") (Join-Path $stage "storage") @() @(".yali-processes.json", "*.lock")

  Copy-FileChecked $releaseExe (Join-Path $stage "YaliShortformStudio.exe")
  Copy-Tree $basePython (Join-Path $stage "runtime\python") @("__pycache__") @("*.pyc")
  $portablePython = Join-Path $stage "runtime\python\python.exe"
  & $portablePython -m pip install --disable-pip-version-check --no-cache-dir --upgrade `
    "fastapi==0.141.1" `
    "uvicorn[standard]==0.52.4" `
    "pydantic==2.13.5" `
    "python-multipart==0.0.27"
  if ($LASTEXITCODE -ne 0) { throw "포터블 Python 의존성 설치에 실패했습니다." }

  Copy-Tree $nodeHome (Join-Path $stage "runtime\node") @(".cache")

  $portableReadme = Join-Path $stage "README-HOME.md"
  Copy-FileChecked (Join-Path $root "docs\portable-bundle.md") $portableReadme

  if (Test-Path -LiteralPath $OutputPath) { Remove-Item -LiteralPath $OutputPath -Force }
  New-Item -ItemType Directory -Force -Path (Split-Path $OutputPath -Parent) | Out-Null
  Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $OutputPath -CompressionLevel Optimal
  if (-not (Test-Path -LiteralPath $OutputPath -PathType Leaf)) { throw "압축 파일이 생성되지 않았습니다." }
  $archive = Get-Item -LiteralPath $OutputPath
  Write-Output ("포터블 번들 생성 완료: {0} ({1:N1} MB)" -f $archive.FullName, ($archive.Length / 1MB))
}
finally {
  if ($wasRunning) { & (Join-Path $root "scripts\start-yali.vbs") | Out-Null }
}
