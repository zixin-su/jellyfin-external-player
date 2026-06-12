#requires -Version 7.0

param(
  [switch]$Zip
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new()

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DistName = "JellyfinExternalPlayer-v0.6.1-win32-x64"
$DistDir = Join-Path $ProjectRoot "dist\$DistName"
$ZipPath = Join-Path $ProjectRoot "dist\$DistName.zip"

Set-Location $ProjectRoot

npm run check
npm run package

foreach ($name in @("data", "cache", "logs", "crashDumps")) {
  $path = Join-Path $DistDir $name
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
}

if ($Zip) {
  if (Test-Path -LiteralPath $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
  }
  Compress-Archive -LiteralPath $DistDir -DestinationPath $ZipPath -CompressionLevel Optimal
  Write-Host "Release archive: $ZipPath"
} else {
  Write-Host "Packaged app: $DistDir"
}
