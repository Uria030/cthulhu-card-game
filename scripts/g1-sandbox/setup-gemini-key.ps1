# Setup Gemini API Key for G1 sandbox auto-gen scripts
# 規範依據:c:\Ug\docs\Claude Code 本地 API Key 安全規範 v0.1_26042605.md
# 三紅線:不進 git / 不進前端 bundle / 不進產出檔
$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..') | Select-Object -ExpandProperty Path
$KeyFile = Join-Path $RepoRoot '.gemini-key'

Write-Host ''
Write-Host '════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host '  G1 自動生成腳本 — Gemini API Key 設定' -ForegroundColor Cyan
Write-Host '════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host ''
Write-Host "Repo root: $RepoRoot"
Write-Host "Key file:  $KeyFile (已 .gitignore,不會進 git)"
Write-Host ''

if (Test-Path $KeyFile) {
  $existing = Get-Content $KeyFile -Raw
  if ($existing -and $existing.Trim()) {
    Write-Host "已存在 .gemini-key(長度 $($existing.Trim().Length) 字元)" -ForegroundColor Yellow
    $reset = Read-Host "要重新設定嗎? (y/N)"
    if ($reset -ne 'y' -and $reset -ne 'Y') {
      Write-Host "保留既有 key,結束。" -ForegroundColor Green
      Write-Host ''
      Read-Host "按 Enter 關閉視窗"
      exit 0
    }
  }
}

Write-Host ''
Write-Host "請貼入 Gemini API Key(從 https://aistudio.google.com 取得):" -ForegroundColor Cyan
Write-Host "(輸入時不會顯示,貼上後按 Enter)"
$secureKey = Read-Host -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
$plainKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

if (-not $plainKey -or $plainKey.Trim().Length -lt 20) {
  Write-Host ''
  Write-Host "✗ Key 看起來太短(< 20 字元),取消寫入。" -ForegroundColor Red
  Read-Host "按 Enter 關閉視窗"
  exit 1
}

Set-Content -Path $KeyFile -Value $plainKey.Trim() -NoNewline -Encoding UTF8
Write-Host ''
Write-Host "✓ 已寫入 .gemini-key(長度 $($plainKey.Trim().Length) 字元)" -ForegroundColor Green
Write-Host ''
Write-Host "下次執行任何 G1 自動生成腳本(05/07/08)會自動讀取本檔。" -ForegroundColor Green
Write-Host ''
Read-Host "按 Enter 關閉視窗"
