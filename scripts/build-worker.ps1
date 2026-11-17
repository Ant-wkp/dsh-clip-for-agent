param(
    [Parameter(Mandatory)] [string] $Sdk,
    [Parameter(Mandatory)] [string] $OpusDll,
    [string] $Python = 'python'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$sdkSource = Join-Path (Resolve-Path -LiteralPath $Sdk) 'src'
$build = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid()))
try {
    $dll = Join-Path $build.FullName 'libopus.dll'
    Copy-Item -LiteralPath $OpusDll -Destination $dll
    $options = @(
        '--noconfirm', '--log-level', 'WARN', '--onefile', '--name', 'clip-worker'
        '--paths', $sdkSource, '--collect-submodules', 'bleak.backends.winrt', '--exclude-module', 'dbus_fast'
        '--add-binary', "$dll;.", '--workpath', (Join-Path $build.FullName 'work'), '--specpath', $build.FullName
        '--distpath', (Join-Path $root 'runtime/win32-x64'), (Join-Path $root 'worker/main.py')
    )
    & $Python -m PyInstaller @options
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller exited with code $LASTEXITCODE" }
} finally {
    Remove-Item -LiteralPath $build.FullName -Recurse -Force
}
