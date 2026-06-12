#requires -Version 7.0

param(
  [Parameter(Mandatory = $true)]
  [string]$Tag,

  [Parameter(Mandatory = $true)]
  [string]$AssetPath,

  [Parameter(Mandatory = $true)]
  [string]$ReleaseNotesPath,

  [string]$Repo = "zixin-su/jellyfin-external-player",
  [string]$ReleaseName = "Jellyfin 外部播放器 $Tag",
  [switch]$SkipAssetUpload
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Get-GitHubToken {
  $credText = "protocol=https`nhost=github.com`n`n" | git credential fill
  $token = (($credText -split "`n") | Where-Object { $_ -like "password=*" } | Select-Object -First 1) -replace "^password=", ""
  if (-not $token) {
    throw "Could not retrieve GitHub token from Git Credential Manager."
  }
  return $token
}

function Send-ReleaseAsset {
  param(
    [Parameter(Mandatory = $true)] [string]$Uri,
    [Parameter(Mandatory = $true)] [string]$Token,
    [Parameter(Mandatory = $true)] [string]$Path
  )

  $file = Get-Item -LiteralPath $Path
  $request = [System.Net.HttpWebRequest]::Create($Uri)
  $request.Method = "POST"
  $request.UserAgent = "jellyfin-external-player-release"
  $request.Accept = "application/vnd.github+json"
  $request.Headers.Add("Authorization", "Bearer $Token")
  $request.Headers.Add("X-GitHub-Api-Version", "2022-11-28")
  $request.ContentType = "application/zip"
  $request.ContentLength = $file.Length
  $request.AllowWriteStreamBuffering = $false
  $request.Timeout = 900000
  $request.ReadWriteTimeout = 900000

  $buffer = New-Object byte[] (1024 * 1024)
  $inputStream = [System.IO.File]::OpenRead($file.FullName)
  try {
    $requestStream = $request.GetRequestStream()
    try {
      while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $requestStream.Write($buffer, 0, $read)
      }
    } finally {
      $requestStream.Dispose()
    }
  } finally {
    $inputStream.Dispose()
  }

  $response = $request.GetResponse()
  try {
    $reader = [System.IO.StreamReader]::new($response.GetResponseStream(), [System.Text.Encoding]::UTF8)
    return $reader.ReadToEnd() | ConvertFrom-Json
  } finally {
    $response.Dispose()
  }
}

if (-not (Test-Path -LiteralPath $AssetPath)) {
  throw "Asset not found: $AssetPath"
}
if (-not (Test-Path -LiteralPath $ReleaseNotesPath)) {
  throw "Release notes not found: $ReleaseNotesPath"
}

$token = Get-GitHubToken
$headers = @{
  Authorization = "Bearer $token"
  Accept = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
}
$releaseBody = Get-Content -LiteralPath $ReleaseNotesPath -Raw -Encoding utf8

try {
  $createBody = @{
    tag_name = $Tag
    target_commitish = "main"
    name = $ReleaseName
    body = $releaseBody
    draft = $false
    prerelease = $false
  } | ConvertTo-Json -Depth 5
  $release = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$Repo/releases" -Headers $headers -Body $createBody -ContentType "application/json; charset=utf-8" -UserAgent "jellyfin-external-player-release"
} catch {
  if ($_.Exception.Response -and $_.Exception.Response.StatusCode.value__ -eq 422) {
    $release = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$Repo/releases/tags/$Tag" -Headers $headers -UserAgent "jellyfin-external-player-release"
    $patchBody = @{
      name = $ReleaseName
      body = $releaseBody
    } | ConvertTo-Json -Depth 5
    $release = Invoke-RestMethod -Method Patch -Uri "https://api.github.com/repos/$Repo/releases/$($release.id)" -Headers $headers -Body $patchBody -ContentType "application/json; charset=utf-8" -UserAgent "jellyfin-external-player-release"
  } else {
    throw
  }
}

if ($SkipAssetUpload) {
  [ordered]@{
    release = $release.html_url
    asset = $null
    skippedAsset = $true
  } | ConvertTo-Json -Depth 5
  return
}

$assetName = Split-Path -Leaf $AssetPath
foreach ($asset in @($release.assets)) {
  if ($asset.name -eq $assetName) {
    Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$Repo/releases/assets/$($asset.id)" -Headers $headers -UserAgent "jellyfin-external-player-release" | Out-Null
  }
}

$uploadBase = [regex]::Replace([string]$release.upload_url, "\{.*$", "")
$uploadUrl = $uploadBase + "?name=" + [uri]::EscapeDataString($assetName)
$uploaded = Send-ReleaseAsset -Uri $uploadUrl -Token $token -Path $AssetPath

[ordered]@{
  release = $release.html_url
  asset = $uploaded.browser_download_url
} | ConvertTo-Json -Depth 5
