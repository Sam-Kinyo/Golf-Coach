# Add DKIM / SPF / DMARC records to Cloudflare for chengzhu.co.
#
# Idempotent — if a record with matching name+type+content already exists,
# it is skipped. If a record with same name+type but DIFFERENT content exists,
# the script warns and skips (never overwrites).
#
# Requires a Cloudflare API token with scope: Zone > DNS > Edit on chengzhu.co
#
# Usage: .\cf-add-records.ps1
#        (or: powershell -ExecutionPolicy Bypass -File ./cf-add-records.ps1)

param(
  [string]$Zone = 'chengzhu.co'
)

$ErrorActionPreference = 'Stop'

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
if (-not $zoneRes.success) { throw ("CF error: " + ($zoneRes.errors | ConvertTo-Json -Depth 5)) }
if ($zoneRes.result.Count -eq 0) { throw "Zone $Zone not found (token lacks access?)" }
$zoneId = $zoneRes.result[0].id
Write-Host "[OK] zone_id = $zoneId" -ForegroundColor Green

Write-Host ''
Write-Host '=== Pulling existing records for idempotency ===' -ForegroundColor Cyan
$existing = @()
$page = 1
while ($true) {
  $r = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records?per_page=100&page=$page" -Headers $headers
  $existing += $r.result
  if ($r.result_info.page -ge $r.result_info.total_pages) { break }
  $page++
}
Write-Host ("[OK] fetched {0} existing records" -f $existing.Count) -ForegroundColor Green

# Workspace DKIM public key (2048-bit, selector: google)
$GoogleDkim = 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArO8vXJfExUhwl64dS6hP7/y2joqCOxFm7UbMxzAkhRZZ73Qo6fj2/V5OkVwbbx7s4IvBDJJKUtNeis1rYX55ELPB5qjCTcZ80WHuh6O/ClMPGMhk0yjgiwTpiF6hyvK6Rr3rarjZuw1D6rm3GyjX1aeAuPSDo7RufghyFlSbwcCM13gI9mtbZhGd6STO6dLpz89ZLGYxiICfS2IWniS1WhdVxPTgfwp7w3b2NThK8/v5HsRvJfMU1o35+p/pZnilgilr3AzErIboucnG5eAOL6WfNPxH4jm7oUY3jAOQROdyyKXExwSsUP6d4oZ4jLPorG51BzjyiIxvgD/Av81l3QIDAQAB'

# Resend DKIM public key (1024-bit, selector: resend) — value as returned by Resend API
$ResendDkim = 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCwm5nEcQeKvGKUzRHjx3r7RFeGi+a8jfPe7L1tOGiKexETyS6LEGyyy1cvs+XQb/f7K0flxzrCRL18uEGciM3CHaKJxsjZELQC6aKbB8Irr5N7Ct4glaxabZ44/594KSZj9kOYrq9txv6ZItkxBH23JFftIeJT4Du0BVqAVSUiSQIDAQAB'

$desired = @(
  @{
    type     = 'TXT'
    name     = '_dmarc.chengzhu.co'
    content  = 'v=DMARC1; p=reject; rua=mailto:security@chengzhu.co;'
    ttl      = 3600
    comment  = 'DMARC p=reject'
  },
  @{
    type     = 'TXT'
    name     = 'google._domainkey.chengzhu.co'
    content  = $GoogleDkim
    ttl      = 3600
    comment  = 'Google Workspace DKIM'
  },
  @{
    type     = 'TXT'
    name     = 'resend._domainkey.chengzhu.co'
    content  = $ResendDkim
    ttl      = 3600
    comment  = 'Resend DKIM'
  },
  @{
    type     = 'TXT'
    name     = 'send.chengzhu.co'
    content  = 'v=spf1 include:amazonses.com ~all'
    ttl      = 3600
    comment  = 'Resend SPF (subdomain)'
  },
  @{
    type     = 'MX'
    name     = 'send.chengzhu.co'
    content  = 'feedback-smtp.us-east-1.amazonses.com'
    priority = 10
    ttl      = 3600
    comment  = 'Resend MX (bounce feedback)'
  }
)

Write-Host ''
Write-Host '=== Applying records ===' -ForegroundColor Cyan

$createdCount = 0
$skippedCount = 0
$warnedCount  = 0

foreach ($rec in $desired) {
  $name    = $rec.name
  $type    = $rec.type
  $content = $rec.content

  # Cloudflare TXT content in API is returned without outer quotes; compare directly
  $match = $existing | Where-Object { $_.name -eq $name -and $_.type -eq $type }

  if ($match) {
    $anyMatch = $false
    foreach ($m in $match) {
      if ($m.content -eq $content) { $anyMatch = $true; break }
    }
    if ($anyMatch) {
      Write-Host ("[SKIP] {0,-4} {1} -> exists with matching content" -f $type, $name) -ForegroundColor Yellow
      $skippedCount++
      continue
    } else {
      Write-Host ("[WARN] {0,-4} {1} exists with DIFFERENT content:" -f $type, $name) -ForegroundColor Red
      foreach ($m in $match) {
        $preview = $m.content
        if ($preview.Length -gt 80) { $preview = $preview.Substring(0, 80) + '...' }
        Write-Host ("       have: {0}" -f $preview) -ForegroundColor Red
      }
      $previewWant = $content
      if ($previewWant.Length -gt 80) { $previewWant = $previewWant.Substring(0, 80) + '...' }
      Write-Host ("       want: {0}" -f $previewWant) -ForegroundColor Red
      Write-Host '       (skipped to avoid overwrite; fix manually in Cloudflare)' -ForegroundColor Red
      $warnedCount++
      continue
    }
  }

  $body = [ordered]@{
    type    = $type
    name    = $name
    content = $content
    ttl     = $rec.ttl
  }
  if ($rec.priority) { $body.priority = $rec.priority }
  if ($rec.comment)  { $body.comment  = $rec.comment }
  $json = $body | ConvertTo-Json -Depth 5

  Write-Host ("[CREATE] {0,-4} {1}..." -f $type, $name) -ForegroundColor Cyan
  try {
    $resp = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records" -Headers $headers -Method Post -Body $json
    Write-Host ("         [OK] id = {0}" -f $resp.result.id) -ForegroundColor Green
    $createdCount++
  } catch {
    $errBody = $null
    try { $errBody = $_.ErrorDetails.Message } catch {}
    Write-Host ("         [ERR] {0}" -f $_) -ForegroundColor Red
    if ($errBody) { Write-Host ("         [API] {0}" -f $errBody) -ForegroundColor Red }
  }
}

Write-Host ''
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host ("  Created: {0}" -f $createdCount) -ForegroundColor Green
Write-Host ("  Skipped: {0}" -f $skippedCount) -ForegroundColor Yellow
Write-Host ("  Warned:  {0}" -f $warnedCount) -ForegroundColor Red

Write-Host ''
Write-Host 'Next steps (manual):' -ForegroundColor Green
Write-Host '  1. Wait 2-5 min for DNS propagation'
Write-Host '  2. Resend:    https://resend.com/domains -> chengzhu.co -> Verify DNS'
Write-Host '  3. Workspace: https://admin.google.com/ac/apps/gmail/authenticateemail -> Start authentication'
Write-Host '  4. Security:  delete the Cloudflare API token you used for this script'
Write-Host '                https://dash.cloudflare.com/profile/api-tokens'
