<#
upload.ps1  –  Forge bootstrap (Windows PowerShell 5.1)

Required arguments:
  -ClientId          APS Client ID
  -ClientSecret      APS Client Secret
  -BucketName        OSS bucket key
  -FilePath          path to template .f3d
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

# ───────────────── TOKEN ─────────────────
$basic =[Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$ClientId`:$ClientSecret"))
$tok   =Invoke-RestMethod -Method Post `
          -Uri https://developer.api.autodesk.com/authentication/v2/token `
          -Headers @{Authorization="Basic $basic"} `
          -ContentType "application/x-www-form-urlencoded" `
          -Body "grant_type=client_credentials&scope=data:read%20data:write%20bucket:create%20bucket:read%20code:all"
$token=$tok.access_token
if(!$token){throw "token failed"}
Write-Host "[token ok]"

# ───────────────── BUCKET ────────────────
try{
 Invoke-RestMethod -Method Post `
   -Uri https://developer.api.autodesk.com/oss/v2/buckets `
   -Headers @{Authorization="Bearer $token"} `
   -ContentType "application/json" `
   -Body (@{bucketKey=$BucketName;policyKey="persistent"}|ConvertTo-Json)
 Write-Host "[bucket created]"
}catch{
 if($_.Exception.Response.StatusCode.Value__ -eq 409){Write-Host "[bucket exists]"}
 else{throw}
}

# helper: single‑part S3 upload
function Upload-Oss {
 param($Bucket,$Object,$Path,$Tok)
 $size=(Get-Item $Path).Length
 $pre =Invoke-RestMethod -Method Get `
        -Uri "https://developer.api.autodesk.com/oss/v2/buckets/$Bucket/objects/$Object/signeds3upload?partNumbers=1&contentLength=$size" `
        -Headers @{Authorization="Bearer $Tok"}
 $url=$pre.url; if(!$url -and $pre.urls){$url=$pre.urls[0]}
 if(!$url -or !$pre.uploadKey){throw "presign failed"}
 Invoke-RestMethod -Method Put -Uri $url -InFile $Path -ContentType "application/octet-stream"
 Invoke-RestMethod -Method Post `
   -Uri "https://developer.api.autodesk.com/oss/v2/buckets/$Bucket/objects/$Object/signeds3upload" `
   -Headers @{Authorization="Bearer $Tok"} `
   -ContentType "application/json" `
   -Body (@{uploadKey=$pre.uploadKey}|ConvertTo-Json)
}

# ───────────────── UPLOAD .JSON ───────────
$obj=[IO.Path]::GetFileName($FilePath)
Upload-Oss -Bucket $BucketName -Object $obj -Path $FilePath -Tok $token
$urn="urn:adsk.objects:os.object:$BucketName/$obj"
Write-Host "[uploaded .json]"