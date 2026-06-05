# Starts Cloudflare quick tunnel to FlowPay API (3011) and updates .env webhook base URL.
$ErrorActionPreference = "Stop"
$flowpay = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $flowpay "tools"
$cloudflared = Join-Path $tools "cloudflared.exe"
$envFile = Join-Path $flowpay "services\api\.env"
$logFile = Join-Path $tools "cloudflared.log"

New-Item -ItemType Directory -Force -Path $tools | Out-Null

if (-not (Test-Path $cloudflared)) {
  Write-Host "Downloading cloudflared..."
  Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/download/2025.4.0/cloudflared-windows-amd64.exe" -OutFile $cloudflared -UseBasicParsing
}

Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

if (Test-Path $logFile) { Remove-Item $logFile -Force }

Start-Process -FilePath $cloudflared -ArgumentList "tunnel","--url","http://127.0.0.1:3011" -RedirectStandardOutput $logFile -RedirectStandardError $logFile -WindowStyle Hidden

$tunnelUrl = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $logFile) {
    $log = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
    if ($log -match "(https://[a-z0-9-]+\.trycloudflare\.com)") {
      $tunnelUrl = $Matches[1]
      break
    }
  }
}

if (-not $tunnelUrl) {
  Write-Error "Tunnel URL not found in $logFile"
}

$webhookUrl = "$tunnelUrl/api/v1/webhooks/CAMPAY"
$content = Get-Content $envFile -Raw
if ($content -match "FLOWPAY_WEBHOOK_BASE_URL=.*") {
  $content = $content -replace "FLOWPAY_WEBHOOK_BASE_URL=.*", "FLOWPAY_WEBHOOK_BASE_URL=$tunnelUrl"
} else {
  $content += "`nFLOWPAY_WEBHOOK_BASE_URL=$tunnelUrl`n"
}
Set-Content -Path $envFile -Value $content -NoNewline

$pasteFile = Join-Path $flowpay "attached_assets\CAMPAY_COPY_PASTE.txt"
@(
  "FlowPay → CamPay portal — copy only these values",
  "================================================",
  "",
  "WEBHOOK / CALLBACK URL (CamPay app → Settings)",
  "----------------------------------------------",
  $webhookUrl,
  "",
  "WEBSITE (if asked)",
  "------------------",
  "http://localhost:3010",
  "",
  "RETURN / REDIRECT URL (if asked)",
  "--------------------------------",
  "http://localhost:3010/checkout"
) | Set-Content -Path $pasteFile

Write-Host ""
Write-Host "Tunnel: $tunnelUrl"
Write-Host "Paste in CamPay Settings:"
Write-Host "  $webhookUrl"
Write-Host ""
Write-Host "Updated: $envFile"
Write-Host "Copy file: $pasteFile"
Write-Host "Restart FlowPay API (npm run dev in services/api) if it was already running."
