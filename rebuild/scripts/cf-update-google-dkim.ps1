# Update Cloudflare TXT record for google._domainkey.chengzhu.co
# with the new DKIM value regenerated in Google Admin Console.
#
# Run this AFTER clicking 產生新記錄 in Workspace Admin,
# BEFORE clicking 開始驗證.
#
# Usage: powershell -ExecutionPolicy Bypass -File .\cf-update-google-dkim.ps1

param(
  [string]$Zone = 'chengzhu.co'
)

$ErrorActionPreference = 'Stop'

$RecordName = 'google._domainkey.chengzhu.co'
$NewContent = 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt+FFm+Dgh6KswLF7OSCRPvbN4nSMoiXqzPxSS35oAkXAFvmbJUtdLjPBlCSykqZMcMMJfUu0OmLF+XGbMtXWmAcii5f7Qv/87cLAfkUCxUZQ2bJsDDROtxMvpE0D6Nlkp1ZC87C8cgiQBoRju5c3t2lEJmZf+VFX+5eS3kMp4pQp2IH9Sd7vxin/mblvE2/mRCV+76rCBtnOIrfyaSmFRY1Lm+kx93aZnJ/hcMjteOllYdVrL84BMsGDJgPHcMKZuDO9U7sIDG+HpYUhEmOZ6u2UWFaK7vLIj0sX03oEyRe8K/a+v78I4ScaQEq/gvUjhaAgftc6Wz0VB9uDKEdX7wIDAQAB'

$secure = Read-Host "Paste Cloudflare API token (Zone:DNS:Edit scope, input hidden)" -AsSecureString
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
if ($zoneRes.result.Count -eq 0) { throw "Zone $Zone not found (token lacks access?)" }
$zoneId = $zoneRes.result[0].id
Write-Host "[OK] zone_id = $zoneId" -ForegroundColor Green

Write-Host ''
Write-Host "=== Finding existing TXT at $RecordName ===" -ForegroundColor Cyan
$recRes = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records?type=TXT&name=$RecordName" -Headers $headers
if ($recRes.result.Count -eq 0) {
  throw "No existing TXT record at $RecordName — run cf-add-records.ps1 instead"
}
$rec = $recRes.result[0]
$recId = $rec.id
Write-Host "[OK] record_id = $recId" -ForegroundColor Green

if ($rec.content -eq $NewContent) {
  Write-Host ''
  Write-Host "[SKIP] Content already matches — no update needed" -ForegroundColor Yellow
  exit 0
}

Write-Host ''
Write-Host 'Content diff (first 80 chars):' -ForegroundColor Gray
Write-Host ("  OLD: {0}..." -f $rec.content.Substring(0, [Math]::Min(80, $rec.content.Length))) -ForegroundColor Gray
Write-Host ("  NEW: {0}..." -f $NewContent.Substring(0, [Math]::Min(80, $NewContent.Length))) -ForegroundColor Gray

Write-Host ''
Write-Host '=== Updating record ===' -ForegroundColor Cyan
$body = @{
  type    = 'TXT'
  name    = $RecordName
  content = $NewContent
  ttl     = 3600
  comment = 'Google Workspace DKIM (regenerated)'
} | ConvertTo-Json -Depth 5

try {
  $upd = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records/$recId" -Headers $headers -Method Put -Body $body
  Write-Host "[OK] Updated (id: $($upd.result.id))" -ForegroundColor Green
} catch {
  Write-Host ("[ERR] {0}" -f $_) -ForegroundColor Red
  try { Write-Host ("[API] {0}" -f $_.ErrorDetails.Message) -ForegroundColor Red } catch {}
  throw
}

Write-Host ''
Write-Host '=== Verifying via Google DoH (waiting 5s for propagation) ===' -ForegroundColor Cyan
Start-Sleep -Seconds 5
try {
  $doh = Invoke-RestMethod -Uri "https://dns.google/resolve?name=$RecordName&type=TXT"
  if ($doh.Answer -and $doh.Answer.Count -gt 0) {
    $dnsContent = $doh.Answer[0].data
    $dnsNorm = $dnsContent -replace '"', ''
    if ($dnsNorm -eq $NewContent) {
      Write-Host '[OK] DNS returns updated value' -ForegroundColor Green
    } else {
      Write-Host '[WARN] DNS still showing a different value (cache). Retry in 1-2 min.' -ForegroundColor Yellow
      Write-Host ("       got:  {0}..." -f $dnsNorm.Substring(0, [Math]::Min(80, $dnsNorm.Length))) -ForegroundColor Yellow
    }
  } else {
    Write-Host '[WARN] DoH returned no answer' -ForegroundColor Yellow
  }
} catch {
  Write-Host ("[WARN] DoH verify failed: {0}" -f $_) -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Next: go to Google Admin Console DKIM page and click 開始驗證.' -ForegroundColor Green
