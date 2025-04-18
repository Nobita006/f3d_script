<#
.SYNOPSIS
  One‑shot script to set up your Forge OSS bucket and upload a Fusion .f3d template.

.DESCRIPTION
  - You provide your Forge Client ID/Secret, a unique bucket name, and path to your .f3d.
  - The script fetches a 2‑legged token (data:read/write & code:all scopes),
    creates the bucket (if needed), then uploads the .f3d file.
  - At the end you get the OSS URN for the uploaded .f3d, ready for your Design Automation Activity.

.PARAMETER ClientId
  Your APS (Forge) app’s Client ID.

.PARAMETER ClientSecret
  Your APS app’s Client Secret.

.PARAMETER BucketName
  A globally unique bucket name (e.g. "sayan-testbox-templates-1234").

.PARAMETER FilePath
  Full path to your local Fusion 360 .f3d template file.

.EXAMPLE
  PS> ./setup-forge.ps1 -ClientId abc... -ClientSecret xyz... `
                        -BucketName sayan-testbox-templates-1234 `
                        -FilePath 'C:\Users\you\Desktop\Template.f3d'
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$ClientId,

    [Parameter(Mandatory=$true)]
    [string]$ClientSecret,

    [Parameter(Mandatory=$true)]
    [string]$BucketName,

    [Parameter(Mandatory=$true)]
    [ValidateScript({ Test-Path $_ -PathType Leaf })]
    [string]$FilePath
)

# 1) Get 2‑legged access token
Write-Host "Fetching Forge access token..." -ForegroundColor Cyan
$authResponse = Invoke-RestMethod -Method Post `
  -Uri "https://developer.api.autodesk.com/authentication/v1/authenticate" `
  -ContentType "application/x-www-form-urlencoded" `
  -Body @{
    client_id     = $ClientId
    client_secret = $ClientSecret
    grant_type    = "client_credentials"
    scope         = "data:read data:write code:all"
  }

$accessToken = $authResponse.access_token
if (-not $accessToken) {
    Write-Error "Failed to retrieve access token. Check your Client ID/Secret."
    exit 1
}
Write-Host "→ Token acquired." -ForegroundColor Green

# 2) Create bucket (if not exists)
Write-Host "Ensuring bucket '$BucketName' exists..." -ForegroundColor Cyan

$bucketPayload = @{
    bucketKey = $BucketName
    policyKey = "persistent"
} | ConvertTo-Json

try {
    Invoke-RestMethod -Method Post `
      -Uri "https://developer.api.autodesk.com/oss/v2/buckets" `
      -Headers @{ Authorization = "Bearer $accessToken" } `
      -ContentType "application/json" `
      -Body $bucketPayload
    Write-Host "→ Bucket created." -ForegroundColor Green
}
catch {
    if ($_.Exception.Response.StatusCode.Value__ -eq 409) {
        Write-Host "→ Bucket already exists. Continuing…" -ForegroundColor Yellow
    } else {
        Write-Error "Bucket creation failed: $($_.Exception.Message)"
        exit 1
    }
}

# 3) Upload the .f3d file
Write-Host "Uploading '$FilePath' to bucket '$BucketName'..." -ForegroundColor Cyan

$uploadUri = "https://developer.api.autodesk.com/oss/v2/buckets/$BucketName/objects/$(Split-Path $FilePath -Leaf)"
try {
    $uploadResponse = Invoke-RestMethod -Method Put `
      -Uri $uploadUri `
      -Headers @{ Authorization = "Bearer $accessToken" } `
      -InFile $FilePath `
      -ContentType "application/octet-stream"
}
catch {
    Write-Error "Upload failed: $($_.Exception.Message)"
    exit 1
}

# 4) Report the resulting URN
$objectId = $uploadResponse.objectId
Write-Host ""
Write-Host "✅ Upload succeeded!" -ForegroundColor Green
Write-Host "Your Fusion template is now at OSS URN:" -ForegroundColor White
Write-Host "  $objectId" -ForegroundColor Magenta
Write-Host ""
Write-Host "Use this URN in your Design Automation Activity’s 'fusionFile' argument." -ForegroundColor White
