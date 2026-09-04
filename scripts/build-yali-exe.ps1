$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$venvPython = Join-Path $root ".venv\Scripts\python.exe"
$python = if (Test-Path -LiteralPath $venvPython) {
  $venvPython
} else {
  $command = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($command) { $command.Source } else { $null }
}

if (-not $python) {
  throw "Python을 찾을 수 없습니다. 먼저 .venv를 만들거나 Python을 PATH에 추가하세요."
}

& $python -c "import PyInstaller" 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller가 설치되어 있지 않습니다. 다음 명령으로 설치하세요: `"$python`" -m pip install 'pyinstaller>=6,<7'"
}

$launcher = Join-Path $PSScriptRoot "yali-launcher.py"
$buildRoot = Join-Path $root ".build\yali-launcher"
$releaseRoot = Join-Path $root "release"
New-Item -ItemType Directory -Force -Path $buildRoot, $releaseRoot | Out-Null

& $python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --noconsole `
  --name "YaliShortformStudio" `
  --distpath $releaseRoot `
  --workpath $buildRoot `
  --specpath $buildRoot `
  $launcher

if ($LASTEXITCODE -ne 0) {
  throw "YaliShortformStudio.exe 빌드에 실패했습니다."
}

$executable = Join-Path $releaseRoot "YaliShortformStudio.exe"
if (-not (Test-Path -LiteralPath $executable)) {
  throw "빌드 결과물을 찾을 수 없습니다: $executable"
}

Write-Output "빌드 완료: $executable"
