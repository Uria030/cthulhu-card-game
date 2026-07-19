param(
  [string]$BasePath = 'packages/client/public/game-art/calibration-26071308/A-study-v1.png',
  [string]$OverlayRoot = 'packages/client/public/game-art/calibration-26071308/silhouette-overlays',
  [string]$OutputDir = 'packages/client/public/game-art/calibration-26071308/silhouette-overlays/assemblies'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not ('ArtCalibration.SeatSetComposer' -as [type])) {
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

namespace ArtCalibration {
  public static class SeatSetComposer {
    private static Bitmap Load(string path) {
      if (!File.Exists(path)) throw new FileNotFoundException("Missing assembly layer.", path);
      return new Bitmap(path);
    }

    private static void AssertCanvas(Bitmap layer, Bitmap baseImage, string path) {
      if (layer.Width != baseImage.Width || layer.Height != baseImage.Height)
        throw new InvalidOperationException("Layer canvas differs from base: " + path);
    }

    public static void Run(string basePath, string foregroundPath, string outputPath,
      string[] behindPaths, string[] frontPaths) {
      using (var baseImage = Load(basePath))
      using (var foreground = Load(foregroundPath))
      using (var output = new Bitmap(baseImage.Width, baseImage.Height, PixelFormat.Format32bppArgb)) {
        AssertCanvas(foreground, baseImage, foregroundPath);
        output.SetResolution(baseImage.HorizontalResolution, baseImage.VerticalResolution);
        using (var graphics = Graphics.FromImage(output)) {
          graphics.CompositingMode = CompositingMode.SourceOver;
          graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
          graphics.DrawImageUnscaled(baseImage, 0, 0);
          foreach (string path in behindPaths) using (var layer = Load(path)) {
            AssertCanvas(layer, baseImage, path);
            graphics.DrawImageUnscaled(layer, 0, 0);
          }
          graphics.DrawImageUnscaled(foreground, 0, 0);
          foreach (string path in frontPaths) using (var layer = Load(path)) {
            AssertCanvas(layer, baseImage, path);
            graphics.DrawImageUnscaled(layer, 0, 0);
          }
        }
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
        output.Save(outputPath, ImageFormat.Png);
      }
    }
  }
}
'@
}

$baseResolved = (Resolve-Path -LiteralPath $BasePath).Path
$overlayResolved = (Resolve-Path -LiteralPath $OverlayRoot).Path
$outputResolved = [IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputDir))
[IO.Directory]::CreateDirectory($outputResolved) | Out-Null
$foregroundPath = Join-Path $overlayResolved 'shared/board-foreground.png'

$sets = @(
  @{ Id='set-A'; Seats=@('seat-1A','seat-2C','seat-3A','seat-4A') },
  @{ Id='set-B'; Seats=@('seat-1B','seat-2D','seat-3B','seat-4B') }
)

$reports = foreach ($set in $sets) {
  $behind = [Collections.Generic.List[string]]::new()
  $front = [Collections.Generic.List[string]]::new()
  $seatReports = foreach ($seatId in $set.Seats) {
    $seatDir = Join-Path $overlayResolved $seatId
    $metadataPath = Join-Path $seatDir ($seatId + '-metadata.json')
    $metadata = Get-Content -LiteralPath $metadataPath -Encoding UTF8 -Raw | ConvertFrom-Json
    if ($metadata.seatId -ne $seatId) { throw "$seatId metadata identity mismatch." }
    if ($metadata.base.sha256 -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $baseResolved).Hash) {
      throw "$seatId base SHA-256 binding mismatch."
    }
    $personPath = Join-Path $seatDir ($seatId + '-person-placed.png')
    switch ($metadata.seatLayer) {
      'behind-foreground' { $behind.Add($personPath) }
      'front-of-foreground' { $front.Add($personPath) }
      default { throw "$seatId has illegal seatLayer '$($metadata.seatLayer)'." }
    }
    [ordered]@{ seatId=$seatId; seatLayer=$metadata.seatLayer; personAsset=$personPath }
  }

  if ($behind.Count -ne 3 -or $front.Count -ne 1) {
    throw "$($set.Id) must contain exactly three behind seats and one front seat."
  }

  $outputPath = Join-Path $outputResolved ($set.Id + '-four-seat.png')
  [ArtCalibration.SeatSetComposer]::Run(
    $baseResolved, $foregroundPath, $outputPath, $behind.ToArray(), $front.ToArray())

  [ordered]@{
    setId = $set.Id
    output = $outputPath
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $outputPath).Hash
    compositeOrder = @('base','behind-foreground seats','shared foreground','front-of-foreground seats')
    seats = @($seatReports)
    gate = 'PASS'
  }
}

$reportPath = Join-Path $outputResolved 'assembly-report.json'
$reports | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $reportPath -Encoding UTF8
$reports | ForEach-Object { [pscustomobject]@{ setId=$_.setId; seats=($_.seats.seatId -join ','); sha256=$_.sha256; gate=$_.gate } } | Format-Table -AutoSize
