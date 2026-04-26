$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$tokenPath = Join-Path $root '.g1-token'
$url = 'https://server-production-fc4f.up.railway.app/api/auth/login'

Write-Host ''
Write-Host '===== G1 沙盒 admin token 取得 =====' -ForegroundColor Cyan
Write-Host ''

$user = Read-Host '帳號 (username)'
$securePw = Read-Host '密碼 (password,輸入時不會顯示)' -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePw)
$pw = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null

Write-Host ''
Write-Host '正在登入...' -ForegroundColor Yellow

try {
    $body = @{ username = $user; password = $pw } | ConvertTo-Json -Compress
    $r = Invoke-RestMethod -Uri $url -Method Post -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 30

    if ($r.success -and $r.data.token) {
        Set-Content -Path $tokenPath -Value $r.data.token -NoNewline -Encoding ASCII
        Write-Host ''
        Write-Host '✓ 成功!Token 已儲存到 .g1-token' -ForegroundColor Green
        Write-Host ('  長度    : {0}' -f $r.data.token.Length)
        Write-Host ('  角色    : {0}' -f $r.data.user.role)
        Write-Host ('  有效時間: 約 {0} 小時' -f [int]($r.data.expiresIn / 3600))
        Write-Host ''
        Write-Host '【下一步】回到 Claude chat,告訴他「token 拿到了」即可。' -ForegroundColor Cyan
    } else {
        Write-Host ''
        Write-Host '✗ 登入失敗,伺服器回應如下:' -ForegroundColor Red
        $r | Format-List
    }
} catch {
    Write-Host ''
    Write-Host '✗ 錯誤:' -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $errBody = $reader.ReadToEnd()
        Write-Host $errBody
    }
}

Write-Host ''
Write-Host '請按任意鍵關閉此視窗...'
[void][System.Console]::ReadKey($true)
