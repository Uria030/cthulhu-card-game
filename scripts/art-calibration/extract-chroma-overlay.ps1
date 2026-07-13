param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$BasePath,
  [Parameter(Mandatory = $true)][string]$OutputDir,
  [Parameter(Mandatory = $true)][string]$Id,
  [Parameter(Mandatory = $true)][int]$TargetX,
  [Parameter(Mandatory = $true)][int]$TargetY,
  [Parameter(Mandatory = $true)][int]$TargetHeight,
  [Parameter(Mandatory = $true)][string]$ForegroundPolygon,
  [int]$KeyDistanceLow = 14,
  [int]$KeyDistanceHigh = 92
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not ('ArtCalibration.ChromaOverlayExtractor' -as [type])) {
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

namespace ArtCalibration {
  public sealed class ChromaResult {
    public int SourceWidth, SourceHeight, CropX, CropY, CropWidth, CropHeight;
    public int PlacedWidth, PlacedHeight, KeyR, KeyG, KeyB;
    public long AlphaPixels;
    public double Coverage;
    public long GreenSpillPixels;
    public bool CornersTransparent;
    public bool BasePlusForegroundEqualsBase;
    public bool ForegroundDerivedFromBaseExact;
  }

  public static class ChromaOverlayExtractor {
    private static Point[] ParsePolygon(string value) {
      string[] pairs = value.Split(';');
      if (pairs.Length < 3) throw new ArgumentException("Foreground polygon requires at least three points.");
      var points = new Point[pairs.Length];
      for (int i = 0; i < pairs.Length; i++) {
        string[] xy = pairs[i].Split(',');
        if (xy.Length != 2) throw new ArgumentException("Invalid polygon point: " + pairs[i]);
        points[i] = new Point(Int32.Parse(xy[0]), Int32.Parse(xy[1]));
      }
      return points;
    }

    private static Color SampleKey(Bitmap bitmap) {
      long r = 0, g = 0, b = 0, count = 0;
      int band = Math.Max(4, Math.Min(bitmap.Width, bitmap.Height) / 64);
      for (int y = 0; y < bitmap.Height; y += 2) {
        for (int x = 0; x < bitmap.Width; x += 2) {
          if (x >= band && x < bitmap.Width - band && y >= band && y < bitmap.Height - band) continue;
          Color c = bitmap.GetPixel(x, y);
          r += c.R; g += c.G; b += c.B; count++;
        }
      }
      return Color.FromArgb((int)(r / count), (int)(g / count), (int)(b / count));
    }

    private static Bitmap Extract(Bitmap source, Color key, int low, int high, out Rectangle bounds, out long alphaPixels) {
      var output = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb);
      int minX = source.Width, minY = source.Height, maxX = -1, maxY = -1;
      alphaPixels = 0;
      for (int y = 0; y < source.Height; y++) {
        for (int x = 0; x < source.Width; x++) {
          Color c = source.GetPixel(x, y);
          double distance = Math.Sqrt(
            (c.R - key.R) * (c.R - key.R) +
            (c.G - key.G) * (c.G - key.G) +
            (c.B - key.B) * (c.B - key.B));
          int alpha = distance <= low ? 0 : distance >= high ? 255 :
            (int)Math.Round((distance - low) * 255.0 / (high - low));
          if (alpha == 0) { output.SetPixel(x, y, Color.Transparent); continue; }

          int neutralCeiling = Math.Max(c.R, c.B);
          int green = Math.Min(c.G, neutralCeiling);
          output.SetPixel(x, y, Color.FromArgb(alpha, c.R, green, c.B));
          if (alpha >= 8) {
            alphaPixels++;
            minX = Math.Min(minX, x); minY = Math.Min(minY, y);
            maxX = Math.Max(maxX, x); maxY = Math.Max(maxY, y);
          }
        }
      }
      if (maxX < minX || maxY < minY) throw new InvalidOperationException("Chroma extraction produced an empty image.");
      const int padding = 8;
      minX = Math.Max(0, minX - padding); minY = Math.Max(0, minY - padding);
      maxX = Math.Min(source.Width - 1, maxX + padding); maxY = Math.Min(source.Height - 1, maxY + padding);
      bounds = Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
      return output;
    }

    private static void Save(Bitmap bitmap, string path) {
      Directory.CreateDirectory(Path.GetDirectoryName(path));
      bitmap.Save(path, ImageFormat.Png);
    }

    private static bool RgbEqual(Bitmap a, Bitmap b) {
      if (a.Width != b.Width || a.Height != b.Height) return false;
      for (int y = 0; y < a.Height; y++) for (int x = 0; x < a.Width; x++) {
        Color ac = a.GetPixel(x, y), bc = b.GetPixel(x, y);
        if (ac.R != bc.R || ac.G != bc.G || ac.B != bc.B) return false;
      }
      return true;
    }

    private static bool ForegroundMatchesBase(Bitmap foreground, Bitmap baseImage) {
      for (int y = 0; y < foreground.Height; y++) for (int x = 0; x < foreground.Width; x++) {
        Color fc = foreground.GetPixel(x, y);
        if (fc.A == 0) continue;
        Color bc = baseImage.GetPixel(x, y);
        if (fc.R != bc.R || fc.G != bc.G || fc.B != bc.B) return false;
      }
      return true;
    }

    public static ChromaResult Run(string inputPath, string basePath, string outputDir, string id,
      int targetX, int targetY, int targetHeight, string foregroundPolygon, int low, int high) {
      using (var input = new Bitmap(inputPath))
      using (var baseImage = new Bitmap(basePath)) {
        Color key = SampleKey(input);
        Rectangle bounds;
        long alphaPixels;
        using (var extracted = Extract(input, key, low, high, out bounds, out alphaPixels))
        using (var crop = extracted.Clone(bounds, PixelFormat.Format32bppArgb)) {
          long greenSpillPixels = 0;
          for (int y = 0; y < crop.Height; y++) for (int x = 0; x < crop.Width; x++) {
            Color c = crop.GetPixel(x, y);
            if (c.A > 0 && c.G > Math.Max(c.R, c.B) + 2) greenSpillPixels++;
          }
          bool cornersTransparent = crop.GetPixel(0, 0).A == 0 && crop.GetPixel(crop.Width - 1, 0).A == 0 &&
            crop.GetPixel(0, crop.Height - 1).A == 0 && crop.GetPixel(crop.Width - 1, crop.Height - 1).A == 0;
          Save(crop, Path.Combine(outputDir, id + "-person.png"));

          int targetWidth = (int)Math.Round(crop.Width * targetHeight / (double)crop.Height);
          var targetRect = new Rectangle(targetX, targetY, targetWidth, targetHeight);
          if (targetRect.Right > baseImage.Width || targetRect.Bottom > baseImage.Height || targetX < 0 || targetY < 0)
            throw new ArgumentOutOfRangeException("Placed person is outside the base canvas.");

          using (var placed = new Bitmap(baseImage.Width, baseImage.Height, PixelFormat.Format32bppArgb))
          using (var foreground = new Bitmap(baseImage.Width, baseImage.Height, PixelFormat.Format32bppArgb))
          using (var foregroundMask = new Bitmap(baseImage.Width, baseImage.Height, PixelFormat.Format32bppArgb))
          using (var basePlusPerson = new Bitmap(baseImage.Width, baseImage.Height, PixelFormat.Format32bppArgb))
          using (var basePlusForeground = new Bitmap(baseImage.Width, baseImage.Height, PixelFormat.Format32bppArgb))
          using (var finalComposite = new Bitmap(baseImage.Width, baseImage.Height, PixelFormat.Format32bppArgb)) {
            foreach (Bitmap canvas in new [] { placed, foreground, foregroundMask, basePlusPerson, basePlusForeground, finalComposite })
              canvas.SetResolution(baseImage.HorizontalResolution, baseImage.VerticalResolution);

            using (var g = Graphics.FromImage(placed)) {
              g.CompositingMode = CompositingMode.SourceCopy;
              g.InterpolationMode = InterpolationMode.HighQualityBicubic;
              g.DrawImage(crop, targetRect);
            }

            Point[] polygon = ParsePolygon(foregroundPolygon);
            using (var path = new GraphicsPath()) {
              path.AddPolygon(polygon);
              using (var g = Graphics.FromImage(foreground)) {
                g.SetClip(path);
                g.DrawImageUnscaled(baseImage, 0, 0);
              }
              using (var g = Graphics.FromImage(foregroundMask)) {
                g.SmoothingMode = SmoothingMode.None;
                g.FillPath(Brushes.White, path);
              }
            }

            using (var g = Graphics.FromImage(basePlusPerson)) {
              g.DrawImageUnscaled(baseImage, 0, 0);
              g.DrawImageUnscaled(placed, 0, 0);
            }
            using (var g = Graphics.FromImage(basePlusForeground)) {
              g.DrawImageUnscaled(baseImage, 0, 0);
              g.DrawImageUnscaled(foreground, 0, 0);
            }
            using (var g = Graphics.FromImage(finalComposite)) {
              g.DrawImageUnscaled(baseImage, 0, 0);
              g.DrawImageUnscaled(placed, 0, 0);
              g.DrawImageUnscaled(foreground, 0, 0);
            }

            Save(placed, Path.Combine(outputDir, id + "-person-placed.png"));
            Save(foreground, Path.Combine(outputDir, "board-foreground.png"));
            Save(foregroundMask, Path.Combine(outputDir, "board-foreground-mask.png"));
            Save(basePlusPerson, Path.Combine(outputDir, id + "-base-plus-person.png"));
            Save(basePlusForeground, Path.Combine(outputDir, "base-plus-foreground.png"));
            Save(finalComposite, Path.Combine(outputDir, id + "-qa-composite.png"));

            bool basePlusForegroundEqualsBase = RgbEqual(basePlusForeground, baseImage);
            bool foregroundDerivedExact = ForegroundMatchesBase(foreground, baseImage);

            return new ChromaResult {
              SourceWidth = input.Width, SourceHeight = input.Height,
              CropX = bounds.X, CropY = bounds.Y, CropWidth = bounds.Width, CropHeight = bounds.Height,
              PlacedWidth = targetWidth, PlacedHeight = targetHeight,
              KeyR = key.R, KeyG = key.G, KeyB = key.B,
              AlphaPixels = alphaPixels,
              Coverage = alphaPixels / (double)(bounds.Width * bounds.Height),
              GreenSpillPixels = greenSpillPixels,
              CornersTransparent = cornersTransparent,
              BasePlusForegroundEqualsBase = basePlusForegroundEqualsBase,
              ForegroundDerivedFromBaseExact = foregroundDerivedExact
            };
          }
        }
      }
    }
  }
}
'@
}

$inputResolved = (Resolve-Path -LiteralPath $InputPath).Path
$baseResolved = (Resolve-Path -LiteralPath $BasePath).Path
$outputResolved = [IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputDir))
[IO.Directory]::CreateDirectory($outputResolved) | Out-Null

$result = [ArtCalibration.ChromaOverlayExtractor]::Run(
  $inputResolved, $baseResolved, $outputResolved, $Id,
  $TargetX, $TargetY, $TargetHeight, $ForegroundPolygon,
  $KeyDistanceLow, $KeyDistanceHigh
)

$report = [ordered]@{
  id = $Id
  source = [ordered]@{
    path = $inputResolved
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $inputResolved).Hash
    width = $result.SourceWidth
    height = $result.SourceHeight
    sampledKeyRgb = @($result.KeyR, $result.KeyG, $result.KeyB)
  }
  base = [ordered]@{
    path = $baseResolved
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $baseResolved).Hash
  }
  person = [ordered]@{
    asset = "$Id-person.png"
    sourceCrop = [ordered]@{ x = $result.CropX; y = $result.CropY; width = $result.CropWidth; height = $result.CropHeight }
    placement = [ordered]@{ x = $TargetX; y = $TargetY; width = $result.PlacedWidth; height = $result.PlacedHeight }
    alphaPixels = $result.AlphaPixels
    coverage = [Math]::Round($result.Coverage, 6)
    greenSpillPixels = $result.GreenSpillPixels
    cornersTransparent = $result.CornersTransparent
  }
  foregroundLayer = [ordered]@{
    scope = 'shared'
    asset = 'board-foreground.png'
    mask = 'board-foreground-mask.png'
    source = 'derived-from-base'
    polygon = $ForegroundPolygon
  }
  compositeOrder = @('base', 'person', 'foregroundOcclusion')
  occlusionCoupledToPlacement = $true
  qa = [ordered]@{
    basePlusForegroundEqualsBase = $result.BasePlusForegroundEqualsBase
    foregroundDerivedFromBaseExact = $result.ForegroundDerivedFromBaseExact
  }
  binding = 'Changing base SHA-256, canvas size, foreground polygon, or placement invalidates this calibration.'
}

$report | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $outputResolved "$Id-metadata.json") -Encoding UTF8
$report | ConvertTo-Json -Depth 7
