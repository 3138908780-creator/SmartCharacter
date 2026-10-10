param([ValidateSet('install','start')][string]$Mode = 'start')
$ErrorActionPreference = 'Stop'
try {
  if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'This candidate requires Windows x64.' }
  $ScRoot = Split-Path -Parent $PSScriptRoot
  $ScTarget = 'win32-x64'
  $ScData = if ($env:SC_LOCAL_USER_DATA) {$env:SC_LOCAL_USER_DATA} else {Join-Path $env:LOCALAPPDATA 'SmartCharacterLocalWeb'}
  $ScStore = if ($env:SC_LOCAL_COMPONENT_STORE) {$env:SC_LOCAL_COMPONENT_STORE} else {Join-Path $ScData 'components'}
  if (-not [IO.Path]::IsPathRooted($ScData) -or -not [IO.Path]::IsPathRooted($ScStore)) { throw 'Data and component paths must be absolute.' }
  $ScLock = (Get-Content -LiteralPath (Join-Path $ScRoot 'resources/node-bootstrap-lock.json') -Raw | ConvertFrom-Json).targets.'win32-x64'
  $ScNodeHome = Join-Path $ScStore 'node/win32-x64-24.14.0'
  $ScNode = Join-Path $ScNodeHome 'node.exe'
  if ($Mode -eq 'install') {
    if (-not (Test-Path -LiteralPath (Join-Path $ScRoot 'bundles/sc-components-win32-x64.tar.gz'))) {throw 'The complete Windows x64 component bundle is missing; use the matching full candidate package.'}
    if (-not (Test-Path -LiteralPath $ScNode) -or (Get-FileHash -LiteralPath $ScNode -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ScLock.binarySha256) {
    $ScCache = Join-Path $ScStore 'downloads'
    New-Item -ItemType Directory -Force -Path $ScCache,(Join-Path $ScStore 'node') | Out-Null
    $ScArchive = Join-Path $ScCache $ScLock.file
    if (-not (Test-Path -LiteralPath $ScArchive)) {
      $ScPartial = "$ScArchive.partial"
      $ScBundled = Join-Path $ScRoot "bundles/$($ScLock.file)"
      $ScCached = Join-Path $ScRoot ".runtime-cache/downloads/$($ScLock.file)"
      if (Test-Path -LiteralPath $ScBundled) {Copy-Item -LiteralPath $ScBundled -Destination $ScPartial}
      elseif (Test-Path -LiteralPath $ScCached) {Copy-Item -LiteralPath $ScCached -Destination $ScPartial}
      elseif ($env:SC_INSTALL_OFFLINE -eq '1') {throw 'Offline Node archive is missing.'}
      else {
        & (Join-Path $env:SystemRoot 'System32/curl.exe') --fail --location --retry 2 $ScLock.url --output $ScPartial
        if ($LASTEXITCODE -ne 0) {Remove-Item -LiteralPath $ScPartial -Force -ErrorAction SilentlyContinue; throw 'Node download failed.'}
      }
      if ((Get-FileHash -LiteralPath $ScPartial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ScLock.sha256) {Remove-Item -LiteralPath $ScPartial -Force; throw 'Node download checksum failed.'}
      Move-Item -LiteralPath $ScPartial -Destination $ScArchive
    }
    if ((Get-FileHash -LiteralPath $ScArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ScLock.sha256) {throw 'Node cache checksum failed; remove only this archive and retry.'}
    $ScStage = Join-Path $ScStore "node/stage-$([Guid]::NewGuid())"
    try {
      Expand-Archive -LiteralPath $ScArchive -DestinationPath $ScStage
      $ScExtracted = Join-Path $ScStage $ScLock.directory
      if ((Get-FileHash -LiteralPath (Join-Path $ScExtracted 'node.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ScLock.binarySha256) {throw 'Extracted Node checksum failed.'}
      if (Test-Path -LiteralPath $ScNodeHome) {Move-Item -LiteralPath $ScNodeHome -Destination "$ScNodeHome.previous-$([Guid]::NewGuid())"}
      Move-Item -LiteralPath $ScExtracted -Destination $ScNodeHome
    } finally {if (Test-Path -LiteralPath $ScStage) {Remove-Item -LiteralPath $ScStage -Recurse -Force}}
    }
  }
  if (-not (Test-Path -LiteralPath $ScNode)) {throw 'Run the SmartCharacter installer first.'}
  if ((Get-FileHash -LiteralPath $ScNode -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ScLock.binarySha256) {throw 'Installed Node checksum failed; reinstall.'}
  $env:SC_LOCAL_COMPONENT_STORE = $ScStore
  if ($Mode -eq 'install') {& $ScNode (Join-Path $ScRoot 'scripts/install-local-web.mjs')}
  else {& $ScNode (Join-Path $ScRoot 'scripts/launch-installed.mjs')}
  exit $LASTEXITCODE
} catch {Write-Host "SmartCharacter: $($_.Exception.Message)"; exit 1}
