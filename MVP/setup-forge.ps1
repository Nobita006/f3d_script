<#  setup‑forge.ps1  –  Forge bootstrap (PowerShell 5, ASCII)  #>

param(
  [string]$ClientId,
  [string]$ClientSecret,
  [string]$BucketName,
  [ValidateScript({Test-Path $_ -PathType Leaf})][string]$FilePath,
  [ValidateScript({Test-Path $_ -PathType Leaf})][string]$AppBundleZipPath,
  [string]$AppBundleName,
  [string]$ActivityId
)

# 1) TOKEN ----------------------------------------------------------------
Write-Host "`n[1] token..."
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$ClientId`:$ClientSecret"))
$tok   = Invoke-RestMethod -Method Post `
          -Uri https://developer.api.autodesk.com/authentication/v2/token `
          -Headers @{Authorization="Basic $basic"} `
          -ContentType "application/x-www-form-urlencoded" `
          -Body "grant_type=client_credentials&scope=data:read%20data:write%20bucket:create%20bucket:read%20code:all"
$token = $tok.access_token
if(!$token){throw "token failed"}
Write-Host "    ok ($($tok.expires_in)s)"

# 2) BUCKET ---------------------------------------------------------------
Write-Host "[2] bucket..."
try{
  Invoke-RestMethod -Method Post `
    -Uri https://developer.api.autodesk.com/oss/v2/buckets `
    -Headers @{Authorization="Bearer $token"} `
    -ContentType "application/json" `
    -Body (@{bucketKey=$BucketName;policyKey="persistent"}|ConvertTo-Json)
  Write-Host "    created."
}catch{
  if($_.Exception.Response.StatusCode.Value__ -eq 409){Write-Host "    exists."}
  else{throw}
}

# helper: single‑part direct‑to‑S3 upload
function New-OssObject {
  param($Bucket,$Object,$Path,$Tok)
  $size = (Get-Item $Path).Length
  $pre  = Invoke-RestMethod -Method Get `
           -Uri "https://developer.api.autodesk.com/oss/v2/buckets/$Bucket/objects/$Object/signeds3upload?partNumbers=1&contentLength=$size" `
           -Headers @{Authorization="Bearer $Tok"}
  $url  = $pre.url
  if(!$url){ $url = $pre.urls[0] }
  $key  = $pre.uploadKey

  Invoke-RestMethod -Method Put -Uri $url -InFile $Path -ContentType "application/octet-stream"

  Invoke-RestMethod -Method Post `
    -Uri "https://developer.api.autodesk.com/oss/v2/buckets/$Bucket/objects/$Object/signeds3upload" `
    -Headers @{Authorization="Bearer $Tok"} `
    -ContentType "application/json" `
    -Body (@{uploadKey=$key}|ConvertTo-Json)
}

# 3) UPLOAD .f3d ----------------------------------------------------------
Write-Host "[3] upload .f3d..."
$obj  = [IO.Path]::GetFileName($FilePath)
New-OssObject -Bucket $BucketName -Object $obj -Path $FilePath -Tok $token
$urn  = "urn:adsk.objects:os.object:$BucketName/$obj"
Write-Host "    -> $urn"

# 4) APPBUNDLE ------------------------------------------------------------
Write-Host "[4] AppBundle..."
$abBody = @{id=$AppBundleName;engine="Autodesk.Fusion+Latest";description="DXF export"}|ConvertTo-Json
try{
  $abRes = Invoke-RestMethod -Method Post `
           -Uri https://developer.api.autodesk.com/da/us-east/v3/appbundles `
           -Headers @{Authorization="Bearer $token"} `
           -ContentType "application/json" `
           -Body $abBody
}catch{
  if($_.Exception.Response.StatusCode.Value__ -eq 409){
    # bundle exists – create new version
    $abRes = Invoke-RestMethod -Method Post `
              -Uri "https://developer.api.autodesk.com/da/us-east/v3/appbundles/$AppBundleName/versions" `
              -Headers @{Authorization="Bearer $token"} `
              -ContentType "application/json" `
              -Body (@{engine="Autodesk.Fusion+Latest"}|ConvertTo-Json)
  } else { throw }
}
$up = $abRes.uploadParameters
Write-Host "    version $($abRes.version)"

# upload ZIP if new uploadParameters present
if($up){
  Add-Type -AssemblyName System.Net.Http
  $hc    = New-Object System.Net.Http.HttpClient
  $multi = New-Object System.Net.Http.MultipartFormDataContent
  foreach($fd in $up.formData){
    $multi.Add([System.Net.Http.StringContent]::new($fd.value),$fd.key)
  }
  $fs = [System.IO.File]::OpenRead($AppBundleZipPath)
  $sc = New-Object System.Net.Http.StreamContent($fs)
  $sc.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("application/octet-stream")
  $multi.Add($sc,"file",[IO.Path]::GetFileName($AppBundleZipPath))
  $resp = $hc.PostAsync($up.endpointURL,$multi).Result
  if(!$resp.IsSuccessStatusCode){throw "ZIP upload failed $($resp.StatusCode)"}
  $fs.Dispose(); $hc.Dispose()
  Write-Host "    ZIP uploaded."
} else {
  Write-Host "    ZIP upload skipped (bundle already latest)."
}

# alias prod (idempotent)
Invoke-RestMethod -Method Post `
  -Uri "https://developer.api.autodesk.com/da/us-east/v3/appbundles/$AppBundleName/aliases" `
  -Headers @{Authorization="Bearer $token"} `
  -ContentType "application/json" `
  -Body (@{id="prod";version=$abRes.version}|ConvertTo-Json)|Out-Null
Write-Host "    alias prod"

# 5) ACTIVITY -------------------------------------------------------------
Write-Host "[5] Activity..."
$act=@{
  id=$ActivityId
  engine="Autodesk.Fusion+Latest"
  commandLine=@('$(engine.path)\FusionCoreConsole.exe')
  appbundles=@("$ClientId.$AppBundleName+prod")
  parameters=@{
    fusionFile=@{localName="template.f3d";verb="get"}
    dims      =@{localName="dims.json"  ;verb="get"}
    TopDXF    =@{localName="Top_flat.dxf" ;verb="put"}
    Side1DXF  =@{localName="Side1_flat.dxf";verb="put"}
    Side2DXF  =@{localName="Side2_flat.dxf";verb="put"}
  }
}|ConvertTo-Json -Depth 10
try{
  Invoke-RestMethod -Method Post `
    -Uri https://developer.api.autodesk.com/da/us-east/v3/activities `
    -Headers @{Authorization="Bearer $token"} `
    -ContentType "application/json" `
    -Body $act|Out-Null
  Write-Host "    activity created."
}catch{
  if($_.Exception.Response.StatusCode.Value__ -eq 409){
    Write-Host "    activity already exists."
  } else { throw }
}

# SUMMARY ----------------------------------------------------------------
Write-Host "`nForge ready:"
Write-Host " URN      : $urn"
Write-Host " Bundle   : $ClientId.$AppBundleName+prod"
Write-Host " Activity : $ActivityId`n"
