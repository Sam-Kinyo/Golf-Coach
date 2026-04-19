# Step 5: Read existing TXT records from Cloudflare for chengzhu.co
#
# Requires a Cloudflare API token with scope:
#   Zone > Zone > Read    (for chengzhu.co)
#   Zone > DNS  > Read    (for chengzhu.co)
#
# Create token at: https://dash.cloudflare.com/profile/api-tokens
#
# Usage: .\cf-read-txt.ps1
#        (or: powershell -ExecutionPolicy Bypass -File ./cf-read-txt.ps1)

param(
  [string]$Zone = 'chengzhu.co'
)

$ErrorActionPreference = 'Stop'

$secure = Read-Host "Paste Cloudflare API token (input hidden)" -AsSecureString
$bstr   = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$token  = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null

if (-not $token) { throw 'No token provided' }

$headers = @{
  Authorization  = "Bearer $token"
  'Content-Type' = 'application/json'
}

Write-Host ''
Write-Host "=== Looking up zone $Zone ===" -ForegroundColor Cyan
$zoneRes = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones?name=$Zone" -Headers $headers
if (-not $zoneRes.success) { throw ("CF error: " + ($zoneRes.errors | ConvertTo-Json -Depth 5)) }
if ($zoneRes.result.Count -eq 0) { throw "Zone $Zone not found (token lacks access?)" }
$zoneId = $zoneRes.result[0].id
Write-Host ("[OK] zone_id = {0}" -f $zoneId) -ForegroundColor Green

Write-Host ''
Write-Host '=== TXT records on chengzhu.co ===' -ForegroundColor Cyan
$recRes = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records?type=TXT&per_page=100" -Headers $headers
if (-not $recRes.success) { throw ("CF error: " + ($recRes.errors | ConvertTo-Json -Depth 5)) }

if ($recRes.result.Count -eq 0) {
  Write-Host '(no TXT records)' -ForegroundColor Yellow
} else {
  $recRes.result | ForEach-Object {
    Write-Host ''
    Write-Host ("Name:    {0}" -f $_.name)
    Write-Host ("Content: {0}" -f $_.content)
    Write-Host ("TTL:     {0}" -f $_.ttl)
  }
}

Write-Host ''
Write-Host '=== All CNAME on _domainkey (existing DKIM) ===' -ForegroundColor Cyan
$cnameRes = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records?type=CNAME&per_page=100" -Headers $headers
$dkim = $cnameRes.result | Where-Object { $_.name -match '_domainkey' }
if ($dkim) {
  $dkim | ForEach-Object {
    Write-Host ("Name:    {0}" -f $_.name)
    Write-Host ("Content: {0}" -f $_.content)
    Write-Host ''
  }
} else {
  Write-Host '(none)' -ForegroundColor Yellow
}
