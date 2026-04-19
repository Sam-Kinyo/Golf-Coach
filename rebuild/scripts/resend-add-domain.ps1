# Step 4: Create chengzhu.co domain in Resend and dump the DNS records.
#
# Prereq (manual):
#   1. Sign up at https://resend.com with sam.kuo@chengzhu.co
#   2. Verify the email
#   3. Create API key at https://resend.com/api-keys  (Full Access is fine)
#
# Then run this script and paste the API key when prompted.
#
# Usage: .\resend-add-domain.ps1
#        (or: powershell -ExecutionPolicy Bypass -File ./resend-add-domain.ps1)

param(
  [string]$Domain = 'chengzhu.co',
  [string]$Region = 'us-east-1'   # us-east-1 | eu-west-1 | sa-east-1 | ap-northeast-1
)

$ErrorActionPreference = 'Stop'

$secure = Read-Host "Paste Resend API key (starts with re_, input hidden)" -AsSecureString
$bstr   = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$token  = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null

if (-not $token) { throw 'No API key provided' }

$headers = @{
  Authorization  = "Bearer $token"
  'Content-Type' = 'application/json'
}

Write-Host ''
Write-Host '=== Checking existing domains ===' -ForegroundColor Cyan
$list = Invoke-RestMethod -Uri 'https://api.resend.com/domains' -Headers $headers
$existing = $list.data | Where-Object { $_.name -eq $Domain }

if ($existing) {
  Write-Host ("[OK] domain {0} already exists (id: {1}, status: {2})" -f $Domain, $existing.id, $existing.status) -ForegroundColor Yellow
  $domainId = $existing.id
} else {
  Write-Host ("=== Creating domain {0} in region {1} ===" -f $Domain, $Region) -ForegroundColor Cyan
  $body = @{ name = $Domain; region = $Region } | ConvertTo-Json
  $created = Invoke-RestMethod -Uri 'https://api.resend.com/domains' -Headers $headers -Method Post -Body $body
  Write-Host ("[OK] created (id: {0}, status: {1})" -f $created.id, $created.status) -ForegroundColor Green
  $domainId = $created.id
}

Write-Host ''
Write-Host '=== DNS records Resend wants (paste these into Cloudflare after merging) ===' -ForegroundColor Cyan
$detail = Invoke-RestMethod -Uri "https://api.resend.com/domains/$domainId" -Headers $headers
if (-not $detail.records) {
  Write-Host '(no records returned)' -ForegroundColor Yellow
} else {
  $detail.records | ForEach-Object {
    Write-Host ''
    Write-Host ("Type:   {0}" -f $_.type)
    Write-Host ("Name:   {0}" -f $_.name)
    Write-Host ("Value:  {0}" -f $_.value)
    if ($_.priority) { Write-Host ("Prio:   {0}" -f $_.priority) }
    if ($_.ttl)      { Write-Host ("TTL:    {0}" -f $_.ttl) }
    Write-Host ("Status: {0}" -f $_.status)
  }
}

# Dump JSON for me to parse
$outPath = Join-Path (Split-Path $MyInvocation.MyCommand.Path) 'resend-records.json'
$detail | ConvertTo-Json -Depth 10 | Set-Content -Path $outPath -Encoding UTF8
Write-Host ''
Write-Host ("[OK] Full JSON saved to {0}" -f $outPath) -ForegroundColor Green
