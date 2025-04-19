<#
test‑work.ps1  –  Forge DA v3 end‑to‑end smoke test

Params:
  -ClientId       APS Client ID
  -ClientSecret   APS Client Secret
  -BucketName     OSS bucket key
  -ActivityId     DA v3 Activity ID   # e.g. ParametricDXFActivity1
  -TemplateFile   name of .f3d in bucket       # default below
  -DimsFile       name of dims.json in bucket  # default below
  -OutputFolder   local folder for DXFs        # default below
#>

param(
  [string]$ClientId,
  [string]$ClientSecret,
  [string]$BucketName,
  [string]$ActivityId,
  [string]$TemplateFile = "Acrylic-Box-parametric-screws.f3d",
  [string]$DimsFile     = "dims.json",
  [string]$OutputFolder = "C:\Temp\ForgeTest"
)

# 1) Get APS v3 token (client_credentials)
$pair  = "$ClientId`:$ClientSecret"
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$tok   = Invoke-RestMethod -Method Post `
  -Uri "https://developer.api.autodesk.com/authentication/v2/token" `
  -Headers @{ Authorization = "Basic $basic" } `
  -ContentType "application/x-www-form-urlencoded" `
  -Body "grant_type=client_credentials&scope=data:read%20data:write%20code:all"
$token = $tok.access_token
if (-not $token) { throw "ERROR: Failed to obtain APS token" }
Write-Host "[token OK]"                               # :contentReference[oaicite:4]{index=4}

# 2) Prepare URNs and unique output filenames
$templateUrn = "urn:adsk.objects:os.object:$BucketName/$TemplateFile"
$dimsUrn     = "urn:adsk.objects:os.object:$BucketName/$DimsFile"
$guid        = [Guid]::NewGuid().ToString("N")
$outTop      = "$guid`_Top.dxf"
$outSide1    = "$guid`_Side1.dxf"
$outSide2    = "$guid`_Side2.dxf"
Write-Host "[template=$TemplateFile  dims=$DimsFile]"

# 3) Submit v3 WorkItem (no "workItem" envelope) to v3 endpoint
$wi = @{
  activityId = $ActivityId
  arguments  = @{
    fusionFile = @{ verb = "get"; url = $templateUrn }
    dims       = @{ verb = "get"; url = $dimsUrn     }
    TopDXF     = @{ verb = "put"; url = "urn:adsk.objects:os.object:$BucketName/$outTop" }
    Side1DXF   = @{ verb = "put"; url = "urn:adsk.objects:os.object:$BucketName/$outSide1" }
    Side2DXF   = @{ verb = "put"; url = "urn:adsk.objects:os.object:$BucketName/$outSide2" }
  }
} | ConvertTo-Json -Depth 5

$response = Invoke-RestMethod -Method Post `
  -Uri "https://developer.api.autodesk.com/da/us-east/v3/workitems" `
  -Headers @{
    Authorization = "Bearer $token"
    "Content-Type" = "application/json"
  } `
  -Body $wi

$wid = $response.id
if (-not $wid) {
  throw "ERROR: WorkItem not accepted. Make sure the URI is /v3/workitems and the JSON has no envelope."  # :contentReference[oaicite:5]{index=5}
}
Write-Host "[submitted WorkItem ID = $wid]"

# 4) Poll for completion via GET /v3/workitems/{id}
for ($i = 0; $i -lt 30; $i++) {
  $status = Invoke-RestMethod -Method Get `
    -Uri "https://developer.api.autodesk.com/da/us-east/v3/workitems/$wid" `
    -Headers @{ Authorization = "Bearer $token" }
  if ($status.status -eq "success") {
    Write-Host "[WorkItem succeeded]" ; break
  }
  if ($status.status -eq "failed") {
    $msgs = $status.messages | ConvertTo-Json
    throw "ERROR: WorkItem failed:`n$msgs"
  }
  Start-Sleep -Seconds 5
}
if ($status.status -ne "success") {
  throw "ERROR: timed out waiting for workitem success"
}

# 5) Download each DXF via OSS signed download URL
New-Item -ItemType Directory -Force -Path $OutputFolder | Out-Null
foreach ($f in @($outTop, $outSide1, $outSide2)) {
  $signed = Invoke-RestMethod -Method Get `
    -Uri "https://developer.api.autodesk.com/oss/v2/buckets/$BucketName/objects/$([uri]::EscapeDataString($f))/signeds3download" `
    -Headers @{ Authorization = "Bearer $token" }

  Invoke-RestMethod -Method Get `
    -Uri $signed.url `
    -OutFile (Join-Path $OutputFolder $f)
  Write-Host "[downloaded $f]"
}

Write-Host "`nAll done. Open the DXFs in $OutputFolder."
