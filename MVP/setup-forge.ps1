<#
setup‑forge.ps1  –  Forge bootstrap (PowerShell 5.1, ASCII only)

Required parameters:
  -ClientId          APS Client ID
  -ClientSecret      APS Client Secret
  -BucketName        OSS bucket key (must be globally unique)
  -FilePath          full path to your .f3d template
  -AppBundleZipPath  full path to ParametricDXFApp.zip
  -AppBundleName     e.g. ParametricDXFApp
  -ActivityId        e.g. ParametricDXFActivity
#>

param(
  [string]$ClientId,
  [string]$ClientSecret,
  [string]$BucketName,
  [ValidateScript({Test-Path $_ -PathType Leaf})][string]$FilePath,
  [ValidateScript({Test-Path $_ -PathType Leaf})][string]$AppBundleZipPath,
  [string]$AppBundleName,
  [string]$ActivityId
)

# ────────────────────────────────────────────────────────
# 1) AUTH: client_credentials → token
# ────────────────────────────────────────────────────────
$pair  = "$ClientId`:$ClientSecret"
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$tok   = Invoke-RestMethod -Method Post `
           -Uri "https://developer.api.autodesk.com/authentication/v2/token" `
           -Headers @{ Authorization = "Basic $basic" } `
           -ContentType "application/x-www-form-urlencoded" `
           -Body "grant_type=client_credentials&scope=data:read%20data:write%20bucket:create%20bucket:read%20code:all"
$token = $tok.access_token
if (-not $token) { throw "ERROR: failed to get APS token" }
Write-Host "[token ok]"

# ────────────────────────────────────────────────────────
# 2) CREATE / VERIFY OSS BUCKET
# ────────────────────────────────────────────────────────
try {
  Invoke-RestMethod -Method Post `
    -Uri "https://developer.api.autodesk.com/oss/v2/buckets" `
    -Headers @{ Authorization = "Bearer $token" } `
    -ContentType "application/json" `
    -Body (@{ bucketKey = $BucketName; policyKey = "persistent" } | ConvertTo-Json)
  Write-Host "[bucket created]"
}
catch {
  if ($_.Exception.Response.StatusCode.Value__ -eq 409) {
    Write-Host "[bucket exists]"
  } else {
    throw
  }
}

# ────────────────────────────────────────────────────────
# 3) Helper: upload a file to OSS via signed S3 URL
# ────────────────────────────────────────────────────────
function Upload-OssObject {
  param($Bucket, $ObjectKey, $LocalPath, $Tok)
  # 3.1) Request presigned S3 URL + uploadKey
  $size = (Get-Item $LocalPath).Length
  $pre  = Invoke-RestMethod -Method Get `
    -Uri "https://developer.api.autodesk.com/oss/v2/buckets/$Bucket/objects/$ObjectKey/signeds3upload?partNumbers=1&contentLength=$size" `
    -Headers @{ Authorization = "Bearer $Tok" }

  $url       = $pre.url
  if (-not $url -and $pre.urls) { $url = $pre.urls[0] }
  if (-not $url -or -not $pre.uploadKey) {
    throw "ERROR: OSS presign failed"
  }

  # 3.2) PUT file to S3
  Invoke-RestMethod -Method Put -Uri $url -InFile $LocalPath -ContentType "application/octet-stream"

  # 3.3) inform OSS that part is complete
  Invoke-RestMethod -Method Post `
    -Uri "https://developer.api.autodesk.com/oss/v2/buckets/$Bucket/objects/$ObjectKey/signeds3upload" `
    -Headers @{ Authorization = "Bearer $Tok"; "Content-Type" = "application/json" } `
    -Body (@{ uploadKey = $pre.uploadKey } | ConvertTo-Json)
}

# ────────────────────────────────────────────────────────
# 4) UPLOAD your .f3d template
# ────────────────────────────────────────────────────────
$f3dName = [IO.Path]::GetFileName($FilePath)
Upload-OssObject -Bucket $BucketName -ObjectKey $f3dName -LocalPath $FilePath -Tok $token
$urn = "urn:adsk.objects:os.object:$BucketName/$f3dName"
Write-Host "[uploaded .f3d]"

# ────────────────────────────────────────────────────────
# 5) CREATE or VERSION your AppBundle (v3)
# ────────────────────────────────────────────────────────
$bundleDef = @{
  id          = $AppBundleName
  engine      = "Autodesk.Fusion+Latest"
  description = "DXF export bundle"
} | ConvertTo-Json

try {
  $ab = Invoke-RestMethod -Method Post `
    -Uri "https://developer.api.autodesk.com/da/us-east/v3/appbundles" `
    -Headers @{ Authorization = "Bearer $token" } `
    -ContentType "application/json" `
    -Body $bundleDef
}
catch {
  if ($_.Exception.Response.StatusCode.Value__ -eq 409) {
    # already exists → create new version
    $ab = Invoke-RestMethod -Method Post `
      -Uri "https://developer.api.autodesk.com/da/us-east/v3/appbundles/$AppBundleName/versions" `
      -Headers @{ Authorization = "Bearer $token" } `
      -ContentType "application/json" `
      -Body (@{ engine = "Autodesk.Fusion+Latest" } | ConvertTo-Json)
  } else {
    throw
  }
}

# ────────────────────────────────────────────────────────
# 6) Extract uploadParameters & upload ZIP via HttpClient
# ────────────────────────────────────────────────────────
$up = $ab.uploadParameters
if (-not $up) {
  throw "ERROR: uploadParameters missing did you call v3/appbundles?"
}
Write-Host "[bundle version $($ab.version)]"

# Build MultipartFormDataContent
$hc      = [System.Net.Http.HttpClient]::new()
$content = [System.Net.Http.MultipartFormDataContent]::new()

# add each form field
foreach ($kv in $up.formData) {
  $sc = [System.Net.Http.StringContent]::new($kv.value)
  $content.Add($sc, $kv.key)
}

# add the zip file itself
$fileStream = [System.IO.File]::OpenRead($AppBundleZipPath)
$fileCont   = [System.Net.Http.StreamContent]::new($fileStream)
$fileName   = [IO.Path]::GetFileName($AppBundleZipPath)
# set content disposition for file
$cd    = [System.Net.Http.Headers.ContentDispositionHeaderValue]::new("form-data")
$cd.Name     = '"file"'
$cd.FileName = '"' + $fileName + '"'
$fileCont.Headers.ContentDisposition = $cd
$content.Add($fileCont, "file", $fileName)

# send the multipart POST
$resp = $hc.PostAsync($up.endpointURL, $content).Result
if (-not $resp.IsSuccessStatusCode) {
  throw "ERROR: ZIP upload failed HTTP $($resp.StatusCode)"
}

Write-Host "[ZIP uploaded to DA]"

# ────────────────────────────────────────────────────────
# 7) Create “prod” alias (idempotent)
# ────────────────────────────────────────────────────────
try {
  Invoke-RestMethod -Method Post `
    -Uri "https://developer.api.autodesk.com/da/us-east/v3/appbundles/$AppBundleName/aliases" `
    -Headers @{ Authorization = "Bearer $token" } `
    -ContentType "application/json" `
    -Body (@{ id = "prod"; version = $ab.version } | ConvertTo-Json) | Out-Null
  Write-Host "[alias prod]"
}
catch {
  # ignore if already exists
}

# ────────────────────────────────────────────────────────
# 8) CREATE your Design Automation Activity
# ────────────────────────────────────────────────────────
$act = @{
  id          = $ActivityId
  engine      = "Autodesk.Fusion+Latest"
  commandLine = @('$(engine.path)\FusionCoreConsole.exe')
  appbundles  = @("$ClientId.$AppBundleName+prod")
  parameters  = @{
    fusionFile = @{ localName = "template.f3d"; verb = "get" }
    dims       = @{ localName = "dims.json"  ; verb = "get" }
    TopDXF     = @{ localName = "Top_flat.dxf" ; verb = "put" }
    Side1DXF   = @{ localName = "Side1_flat.dxf"; verb = "put" }
    Side2DXF   = @{ localName = "Side2_flat.dxf"; verb = "put" }
  }
} | ConvertTo-Json -Depth 10

try {
  Invoke-RestMethod -Method Post `
    -Uri "https://developer.api.autodesk.com/da/us-east/v3/activities" `
    -Headers @{ Authorization = "Bearer $token" } `
    -ContentType "application/json" `
    -Body $act | Out-Null
  Write-Host "[activity created]"
}
catch {
  if ($_.Exception.Response.StatusCode.Value__ -eq 409) {
    Write-Host "[activity exists]"
  } else {
    throw
  }
}

# ────────────────────────────────────────────────────────
# 9) SUMMARY
# ────────────────────────────────────────────────────────
Write-Host "`nForge ready"
Write-Host " URN      : $urn"
Write-Host " Bundle   : $ClientId.$AppBundleName+prod"
Write-Host " Activity : $ActivityId"
