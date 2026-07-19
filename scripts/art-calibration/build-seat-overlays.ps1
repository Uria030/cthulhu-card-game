param(
  [string]$BasePath = 'packages/client/public/game-art/calibration-26071308/A-study-v1.png',
  [string]$OverlayRoot = 'packages/client/public/game-art/calibration-26071308/silhouette-overlays',
  [string]$SourceRoot = 'packages/client/public/game-art/calibration-26071308/silhouette-overlays/chroma-source'
)

$ErrorActionPreference = 'Stop'
$extractor = Join-Path $PSScriptRoot 'extract-chroma-overlay.ps1'
$foregroundPolygon = '0,630;250,615;500,565;700,520;860,540;1080,600;1300,680;1535,780;1535,1023;0,1023'

$seats = @(
  @{ Id='seat-1A'; Source='seat-1A-chroma.png'; Layer='behind-foreground'; X=-180; Y=250; Height=900; Exits=@('left','bottom') },
  @{ Id='seat-1B'; Source='seat-1B-chroma.png'; Layer='behind-foreground'; X=-260; Y=240; Height=900; Exits=@('left','bottom') },
  @{ Id='seat-2C'; Source='seat-2C-chroma.png'; Layer='behind-foreground'; X=755; Y=220; Height=650; Exits=@() },
  @{ Id='seat-2D'; Source='seat-2D-chroma.png'; Layer='behind-foreground'; X=790; Y=215; Height=620; Exits=@() },
  @{ Id='seat-3A'; Source='seat-3A-chroma-v2.png'; Layer='behind-foreground'; X=1100; Y=255; Height=600; Exits=@() },
  @{ Id='seat-3B'; Source='seat-3B-chroma.png'; Layer='behind-foreground'; X=1020; Y=250; Height=560; Exits=@() },
  @{ Id='seat-4A'; Source='seat-4A-chroma.png'; Layer='front-of-foreground'; X=940; Y=230; Height=900; Exits=@('right','bottom') },
  @{ Id='seat-4B'; Source='seat-4B-chroma.png'; Layer='front-of-foreground'; X=1030; Y=250; Height=900; Exits=@('right','bottom') }
)

$reports = foreach ($seat in $seats) {
  $source = Join-Path $SourceRoot $seat.Source
  $output = Join-Path $OverlayRoot $seat.Id
  $arguments = @{
    InputPath = $source
    BasePath = $BasePath
    OutputDir = $output
    Id = $seat.Id
    SeatLayer = $seat.Layer
    TargetX = $seat.X
    TargetY = $seat.Y
    TargetHeight = $seat.Height
    ForegroundPolygon = $foregroundPolygon
  }
  if ($seat.Exits.Count -gt 0) { $arguments.CanvasExitEdges = $seat.Exits }
  & $extractor @arguments | Out-Null

  $metadataPath = Join-Path $output ($seat.Id + '-metadata.json')
  $metadata = Get-Content -LiteralPath $metadataPath -Encoding UTF8 -Raw | ConvertFrom-Json
  $failures = @()
  if ($metadata.person.greenSpillPixels -ne 0) { $failures += 'green-spill' }
  if (-not $metadata.person.cornersTransparent) { $failures += 'opaque-corner' }
  if (-not $metadata.qa.basePlusForegroundEqualsBase) { $failures += 'foreground-composite-drift' }
  if (-not $metadata.qa.foregroundDerivedFromBaseExact) { $failures += 'foreground-not-derived' }
  if ($metadata.qa.personForegroundOverlapPixels -le 0) { $failures += 'no-person-foreground-overlap' }
  if ($metadata.qa.overlapOrderMismatchPixels -ne 0) { $failures += 'z-order-mismatch' }
  if ($failures.Count -gt 0) { throw "$($seat.Id) Gate failed: $($failures -join ', ')" }

  [pscustomobject]@{
    seatId = $seat.Id
    seatLayer = $seat.Layer
    placement = "$($metadata.person.placement.x),$($metadata.person.placement.y),$($metadata.person.placement.width),$($metadata.person.placement.height)"
    canvasExitEdges = ($metadata.canvasExitEdges -join ',')
    alphaPixels = $metadata.person.alphaPixels
    coverage = $metadata.person.coverage
    overlapPixels = $metadata.qa.personForegroundOverlapPixels
    overlapMismatch = $metadata.qa.overlapOrderMismatchPixels
    gate = 'PASS'
  }
}

$reportPath = Join-Path $OverlayRoot 'batch-gate-report.json'
$reports | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding UTF8
$reports | Format-Table -AutoSize
