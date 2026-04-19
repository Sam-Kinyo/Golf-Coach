# Step 1: ADC (Application Default Credentials) setup
#
# Logs in as a Google account (pick sam.kuo@chengzhu.co when browser opens)
# and sets the quota project so SDK API calls are billed to staging.
#
# Usage (PowerShell):  .\setup-adc.ps1
# Or from bash:        powershell -ExecutionPolicy Bypass -File ./setup-adc.ps1

$ErrorActionPreference = 'Stop'

$QuotaProject = 'chengzhu-golf-staging'

Write-Host ''
Write-Host '=== Step 1a: gcloud auth application-default login ===' -ForegroundColor Cyan
Write-Host "Browser will open. Pick: sam.kuo@chengzhu.co" -ForegroundColor Yellow
Write-Host ''
gcloud auth application-default login
if ($LASTEXITCODE -ne 0) { throw 'ADC login failed' }

Write-Host ''
Write-Host "=== Step 1b: set quota project ($QuotaProject) ===" -ForegroundColor Cyan
gcloud auth application-default set-quota-project $QuotaProject
if ($LASTEXITCODE -ne 0) { throw 'set-quota-project failed' }

Write-Host ''
Write-Host '=== Step 1c: verify ===' -ForegroundColor Cyan
$token = gcloud auth application-default print-access-token 2>$null
if (-not $token) { throw 'print-access-token returned empty' }
Write-Host ("[OK] access token acquired (length {0})" -f $token.Length) -ForegroundColor Green

$adcPath = Join-Path $env:APPDATA 'gcloud\application_default_credentials.json'
if (Test-Path $adcPath) {
  $adc = Get-Content $adcPath -Raw | ConvertFrom-Json
  Write-Host ("[OK] quota_project_id = {0}" -f $adc.quota_project_id) -ForegroundColor Green
  Write-Host ("[OK] client_id prefix  = {0}..." -f $adc.client_id.Substring(0, 12)) -ForegroundColor Green
} else {
  Write-Host "[WARN] ADC file not found at $adcPath" -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Step 1 complete.' -ForegroundColor Green
