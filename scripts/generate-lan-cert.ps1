param(
    [string]$IpAddress = "",
    [string]$Password = "customize-gemini-local",
    [switch]$Force,
    [switch]$Silent
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$certRoot = Join-Path $projectRoot "certs"
New-Item -ItemType Directory -Force -Path $certRoot | Out-Null

if (-not $IpAddress) {
    $IpAddress = (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object {
            $_.IPAddress -notlike "127.*" -and
            $_.IPAddress -notlike "169.254.*" -and
            $_.PrefixOrigin -ne "WellKnown"
        } |
        Sort-Object InterfaceMetric |
        Select-Object -First 1 -ExpandProperty IPAddress)
}

if (-not $IpAddress) {
    throw "未找到局域网 IPv4 地址。请手动指定：npm.cmd run cert:lan -- -IpAddress 192.168.1.X"
}

$safeIp = $IpAddress -replace '[^0-9A-Za-z_.-]', '_'
$certDir = Join-Path $certRoot $safeIp
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

$pfxPath = Join-Path $certDir "lan-server.pfx"
$rootCerPath = Join-Path $certDir "phone-root-ca.cer"
$passwordPath = Join-Path $certDir "lan-server-password.txt"
$metadataPath = Join-Path $certDir "metadata.json"

if (-not $Force -and (Test-Path $pfxPath) -and (Test-Path $rootCerPath) -and (Test-Path $passwordPath) -and (Test-Path $metadataPath)) {
    try {
        $metadata = Get-Content $metadataPath -Raw | ConvertFrom-Json
        if ($metadata.ipAddress -eq $IpAddress) {
            if (-not $Silent) {
                Write-Host "证书已存在且 IP 匹配：$IpAddress"
                Write-Host "  服务器证书: $pfxPath"
                Write-Host "  手机根证书: $rootCerPath"
            }
            exit 0
        }
    } catch {}
}

$rootName = "Customize Gemini Local Dev Root CA $IpAddress"
$serverName = "Customize Gemini LAN Server $IpAddress"
$securePassword = ConvertTo-SecureString $Password -AsPlainText -Force

try {
    try {
        if (Test-Path Cert:\CurrentUser\My) {
            Get-ChildItem Cert:\CurrentUser\My -ErrorAction Stop |
                Where-Object { $_.Subject -eq "CN=$rootName" -or $_.Subject -eq "CN=$serverName" } |
                Remove-Item -Force -ErrorAction SilentlyContinue
        }
    } catch {}
    try {
        if (Test-Path Cert:\CurrentUser\Root) {
            Get-ChildItem Cert:\CurrentUser\Root -ErrorAction Stop |
                Where-Object { $_.Subject -eq "CN=$rootName" } |
                Remove-Item -Force -ErrorAction SilentlyContinue
        }
    } catch {}

    $rootCert = New-SelfSignedCertificate `
        -Type Custom `
        -Subject "CN=$rootName" `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -KeyExportPolicy Exportable `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -KeyUsage CertSign, CRLSign, DigitalSignature `
        -TextExtension @("2.5.29.19={critical}{text}ca=TRUE&pathlength=1") `
        -NotAfter (Get-Date).AddYears(10)

    $serverCert = New-SelfSignedCertificate `
        -Type Custom `
        -Subject "CN=$serverName" `
        -DnsName "localhost", $IpAddress `
        -Signer $rootCert `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -KeyExportPolicy Exportable `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -KeyUsage DigitalSignature, KeyEncipherment `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.1", "2.5.29.17={text}dns=localhost&ipaddress=127.0.0.1&ipaddress=$IpAddress") `
        -NotAfter (Get-Date).AddYears(3)

    Export-PfxCertificate -Cert $serverCert -FilePath $pfxPath -Password $securePassword -Force | Out-Null
    Export-Certificate -Cert $rootCert -FilePath $rootCerPath -Force | Out-Null
    Set-Content -Path $passwordPath -Value $Password -Encoding UTF8
    if (Test-Path Cert:\CurrentUser\Root) {
        Import-Certificate -FilePath $rootCerPath -CertStoreLocation "Cert:\CurrentUser\Root" | Out-Null
    }

    $metadata = [ordered]@{
        ipAddress = $IpAddress
        generatedAt = (Get-Date).ToString("o")
        pfxPath = $pfxPath
        rootCertificatePath = $rootCerPath
        passwordPath = $passwordPath
    }
    $metadata | ConvertTo-Json | Set-Content -Path $metadataPath -Encoding UTF8
} catch {
    Remove-Item -Path $certDir -Recurse -Force -ErrorAction SilentlyContinue
    throw
}

if (-not $Silent) {
    Write-Host ""
    Write-Host "证书已生成："
    Write-Host "  证书目录:   $certDir"
    Write-Host "  服务器证书: $pfxPath"
    Write-Host "  手机根证书: $rootCerPath"
    Write-Host "  证书密码:   $passwordPath"
    Write-Host ""
    Write-Host "下一步："
    Write-Host "  1. 运行 npm.cmd start"
    Write-Host "  2. 手机安装并信任 $rootCerPath"
    Write-Host "  3. 手机打开 https://$IpAddress`:3443"
    Write-Host ""
}
