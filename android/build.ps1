$ErrorActionPreference = "Stop"

function Invoke-Native {
    if ($args.Count -lt 1) {
        throw "Invoke-Native: no command specified"
    }
    $file = [string]$args[0]
    $rest = @()
    if ($args.Count -gt 1) {
        $rest = $args[1..($args.Count - 1)]
    }
    & $file @rest
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed ($LASTEXITCODE): $file $($rest -join ' ')"
    }
}

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

$Sdk = $env:ANDROID_SDK_ROOT
if ([string]::IsNullOrWhiteSpace($Sdk)) {
    $Sdk = $env:ANDROID_HOME
}
if ([string]::IsNullOrWhiteSpace($Sdk)) {
    $Sdk = "D:\tools\android-sdk"
}
if (-not (Test-Path (Join-Path $Sdk "platforms\android-34\android.jar"))) {
    throw "Android SDK 34 not found. Set ANDROID_SDK_ROOT or install platforms;android-34."
}

$JavaHome = $env:JAVA_HOME
if ([string]::IsNullOrWhiteSpace($JavaHome)) {
    $candidates = Get-ChildItem "D:\tools\jdk17" -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName "bin\java.exe") } |
        Sort-Object Name -Descending
    if ($candidates.Count -gt 0) {
        $JavaHome = $candidates[0].FullName
    }
}
if ([string]::IsNullOrWhiteSpace($JavaHome) -or -not (Test-Path (Join-Path $JavaHome "bin\javac.exe"))) {
    throw "JDK 17 not found. Set JAVA_HOME."
}

$BuildToolsVersion = "34.0.0"
if ($env:ANDROID_BUILD_TOOLS_VERSION) {
    $BuildToolsVersion = $env:ANDROID_BUILD_TOOLS_VERSION
}
$BuildTools = Join-Path $Sdk "build-tools\$BuildToolsVersion"
$aapt2 = Join-Path $BuildTools "aapt2.exe"
$d8 = Join-Path $BuildTools "d8.bat"
$zipalign = Join-Path $BuildTools "zipalign.exe"
$apksigner = Join-Path $BuildTools "apksigner.bat"
$androidJar = Join-Path $Sdk "platforms\android-34\android.jar"

foreach ($tool in @($aapt2, $d8, $zipalign, $apksigner, $androidJar)) {
    if (-not (Test-Path $tool)) {
        throw "Build tool not found: $tool"
    }
}

$env:JAVA_HOME = $JavaHome
$env:PATH = (Join-Path $JavaHome "bin") + ";" + $env:PATH

$manifestText = Get-Content (Join-Path $ProjectDir "AndroidManifest.xml") -Raw -Encoding UTF8
if ($manifestText -match 'android:versionName="([^"]+)"') {
    $Version = $Matches[1]
} else {
    throw "android:versionName not found in AndroidManifest.xml"
}
if ($manifestText -match 'android:versionCode="([^"]+)"') {
    $VersionCode = [int]$Matches[1]
} else {
    throw "android:versionCode not found in AndroidManifest.xml"
}

$BuildDir = Join-Path $ProjectDir "build"
$DistDir = Join-Path $ProjectDir "dist"
$KeystoreDir = Join-Path $ProjectDir "keystore"
$Keystore = Join-Path $KeystoreDir "focusbox.jks"
$ApkName = "focusbox-android-$Version.apk"
$ApkPath = Join-Path $DistDir $ApkName

if (Test-Path $BuildDir) {
    Remove-Item $BuildDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
New-Item -ItemType Directory -Force -Path $KeystoreDir | Out-Null

if (-not (Test-Path $Keystore)) {
    Write-Host "Generating self-signed update keystore..."
    Invoke-Native (Join-Path $JavaHome "bin\keytool.exe") -genkeypair -v `
        -keystore $Keystore -storetype JKS -alias focusbox `
        -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass focusbox -keypass focusbox `
        -dname "CN=FocusBox, OU=FocusBox, O=FocusBox, L=Local, ST=Local, C=CN"
}

Write-Host "Compiling resources..."
Invoke-Native $aapt2 compile --dir (Join-Path $ProjectDir "res") -o (Join-Path $BuildDir "res.zip")

Write-Host "Linking resources and manifest..."
Invoke-Native $aapt2 link -o (Join-Path $BuildDir "base.apk") `
    -I $androidJar `
    --manifest (Join-Path $ProjectDir "AndroidManifest.xml") `
    (Join-Path $BuildDir "res.zip") `
    --auto-add-overlay

Write-Host "Compiling Java..."
$classesDir = Join-Path $BuildDir "classes"
New-Item -ItemType Directory -Force -Path $classesDir | Out-Null
$javaSources = @(Get-ChildItem (Join-Path $ProjectDir "src") -Recurse -Filter "*.java" |
    ForEach-Object { $_.FullName })
Invoke-Native (Join-Path $JavaHome "bin\javac.exe") -encoding UTF-8 -source 17 -target 17 `
    -classpath $androidJar -d $classesDir @javaSources

$classesJar = Join-Path $BuildDir "classes.jar"
Invoke-Native (Join-Path $JavaHome "bin\jar.exe") --create --file $classesJar -C $classesDir .

Write-Host "Dexing..."
$dexDir = Join-Path $BuildDir "dex"
New-Item -ItemType Directory -Force -Path $dexDir | Out-Null
Invoke-Native $d8 --lib $androidJar --min-api 24 --output $dexDir $classesJar

$unsignedApk = Join-Path $BuildDir "app-unsigned.apk"
Copy-Item (Join-Path $BuildDir "base.apk") $unsignedApk -Force
$dexFile = Join-Path $dexDir "classes.dex"
if (-not (Test-Path $dexFile)) {
    throw "classes.dex was not generated."
}
Invoke-Native (Join-Path $JavaHome "bin\jar.exe") --update --file $unsignedApk -C $dexDir classes.dex

$alignedApk = Join-Path $BuildDir "app-aligned.apk"
Write-Host "Aligning..."
Invoke-Native $zipalign -f -p 4 $unsignedApk $alignedApk

Write-Host "Signing..."
Invoke-Native $apksigner sign `
    --ks $Keystore --ks-key-alias focusbox `
    --ks-pass pass:focusbox --key-pass pass:focusbox `
    --out $ApkPath $alignedApk

Write-Host "Verifying..."
Invoke-Native $apksigner verify --verbose --print-certs $ApkPath

$apk = Get-Item $ApkPath
Write-Host ""
Write-Host "APK: $($apk.FullName)"
Write-Host ("Size: {0:N1} KB" -f ($apk.Length / 1KB))
Write-Host "Version: $Version ($VersionCode)"
