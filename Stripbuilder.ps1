# Stripbuilder.ps1
# Local helper: glue panel images into one vertical strip (ImageMagick).
# Does NOT run on the website — for your PC only.
#
# Requires: ImageMagick (`magick` on PATH)
#   winget install --id ImageMagick.ImageMagick -e
#
# Usage examples (PowerShell):
#   cd E:\website
#   .\Stripbuilder.ps1 -Images "11.jpg","14.jpg","16.jpg" -Out "opening.jpg"
#
#   .\Stripbuilder.ps1 -Images "C:\path\to\a.jpg","C:\path\to\b.jpg" -Out "strip.jpg" -Width 1200
#
#   # If files live in a folder:
#   .\Stripbuilder.ps1 -Dir "C:\Users\grant\.grok\sessions\...\images" -Names "11.jpg","14.jpg","16.jpg","17.jpg","18.jpg" -Out "sleeper_open.jpg"

param(
    [Parameter(Mandatory = $false)]
    [string[]]$Images = @(),

    [Parameter(Mandatory = $false)]
    [string]$Dir = "",

    [Parameter(Mandatory = $false)]
    [string[]]$Names = @(),

    [Parameter(Mandatory = $false)]
    [string]$Out = "strip.jpg",

    [Parameter(Mandatory = $false)]
    [int]$Width = 1200
)

$ErrorActionPreference = "Stop"

function Ensure-Magick {
    $cmd = Get-Command magick -ErrorAction SilentlyContinue
    if (-not $cmd) {
        # Refresh PATH (common after a fresh ImageMagick install in the same session)
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("Path", "User")
        $cmd = Get-Command magick -ErrorAction SilentlyContinue
    }
    if (-not $cmd) {
        Write-Error "ImageMagick not found. Install with: winget install --id ImageMagick.ImageMagick -e"
    }
}

Ensure-Magick

# Build full list of input files
$files = @()

# Allow -Names "a.jpg,b.jpg" as a single string as well as a real array
if ($Names.Count -eq 1 -and $Names[0] -match ',') {
    $Names = @($Names[0] -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
if ($Images.Count -eq 1 -and $Images[0] -match ',') {
    $Images = @($Images[0] -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

if ($Names.Count -gt 0) {
    if (-not $Dir) {
        Write-Error "When using -Names, also pass -Dir (folder containing those files)."
    }
    if (-not (Test-Path -LiteralPath $Dir)) {
        Write-Error "Directory not found: $Dir"
    }
    foreach ($n in $Names) {
        $p = Join-Path $Dir $n
        if (-not (Test-Path -LiteralPath $p)) {
            Write-Error "Missing file: $p"
        }
        $files += (Resolve-Path -LiteralPath $p).Path
    }
}
elseif ($Images.Count -gt 0) {
    foreach ($img in $Images) {
        if (-not (Test-Path -LiteralPath $img)) {
            Write-Error "Missing file: $img"
        }
        $files += (Resolve-Path -LiteralPath $img).Path
    }
}
else {
    Write-Host @"
Stripbuilder — stack panel images top-to-bottom into one strip.

Examples:
  .\Stripbuilder.ps1 -Images "a.jpg","b.jpg","c.jpg" -Out "strip.jpg"
  .\Stripbuilder.ps1 -Dir "C:\path\to\images" -Names "11.jpg","14.jpg","18.jpg" -Out "open.jpg" -Width 1200
"@
    exit 0
}

# Resolve output path (default: next to first image, or current directory)
if (-not [System.IO.Path]::IsPathRooted($Out)) {
    $outDir = if ($Dir) { $Dir } else { Split-Path -Parent $files[0] }
    if (-not $outDir) { $outDir = (Get-Location).Path }
    $Out = Join-Path $outDir $Out
}

$resize = "${Width}x"

Write-Host "Building strip ($($files.Count) panels) → $Out"
Write-Host "Order (top → bottom):"
$i = 1
foreach ($f in $files) {
    Write-Host ("  {0}. {1}" -f $i, $f)
    $i++
}

# -resize WIDTHx  → same width, keep aspect
# -append         → stack vertically
& magick @files -resize $resize -append $Out

if ($LASTEXITCODE -ne 0) {
    Write-Error "magick failed with exit code $LASTEXITCODE"
}

$item = Get-Item -LiteralPath $Out
Write-Host ("Done: {0} ({1:N0} bytes)" -f $item.FullName, $item.Length)
