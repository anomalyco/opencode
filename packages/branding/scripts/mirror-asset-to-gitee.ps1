# DeskFox release 安装包附件上传到 Gitee(本地跑,国内网络秒传)
#
# 背景:GitHub US runner 上行 Gitee CN 被 GFW 节流,50MB 30 分钟传不完,
# 所以 .github/workflows/release-mirror-gitee-deskfox.yml 只镜像 Release 元数据,
# 安装包附件(.exe / .dmg)由 user 本地脚本上传 — 国内 IP 上 Gitee 是秒传级别。
#
# 用法:
#   1. 先跑一次 GitHub Release(`git push --tags` 触发 release-deskfox.yml,
#      用 web UI publish draft → 触发 release-mirror-gitee-deskfox 创 Gitee release)
#   2. 等 ~1 分钟,确认 Gitee release 已建(https://gitee.com/zoulukuang/deskfox/releases)
#   3. 跑本脚本上传附件:
#        $env:GITEE_TOKEN = "<your-gitee-pat>"   # 一次性,新 PowerShell 窗要重设
#        .\packages\branding\scripts\mirror-asset-to-gitee.ps1 -Tag ship-prod-2026.5.3.1
#
# 参数:
#   -Tag <tag>             Release tag,例 ship-prod-2026.5.3.1 / ship-mac-prod-2026.5.10.1
#   -Asset <path>          手动指定上传文件路径(默认根据 tag 自动定位 packages/branding/installer/Output/*.exe)
#   -GiteeToken <token>    手动传 token(默认优先读 User-scope env var,
#                          fallback Process scope `$env:GITEE_TOKEN`)
#                          PowerShell 子进程默认不继承 User-scope,所以 ps1
#                          被 Claude / 自动化任务调起时显式从注册表读更鲁棒
#   -GiteeOwner zoulukuang -GiteeRepo deskfox  (默认值,通常不改)

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Tag,

    [string]$Asset = "",

    [string]$GiteeToken = $(
        # 优先 User-scope(持久化在 HKCU\Environment),fallback Process scope
        # 子进程(Claude / 自动化)启动时不一定继承 User-scope env,显式从注册表读
        $userScope = [Environment]::GetEnvironmentVariable("GITEE_TOKEN", "User")
        if ($userScope) { $userScope } else { $env:GITEE_TOKEN }
    ),

    [string]$GiteeOwner = "zoulukuang",

    [string]$GiteeRepo = "deskfox"
)

$ErrorActionPreference = "Stop"

# ─── 1. 校验 token ─────────────────────────────────────────────────
if (-not $GiteeToken) {
    Write-Host "[ERROR] 未提供 Gitee PAT。" -ForegroundColor Red
    Write-Host "  方式 1:`$env:GITEE_TOKEN = '<your-pat>'  然后再跑本脚本"
    Write-Host "  方式 2:.\mirror-asset-to-gitee.ps1 -Tag $Tag -GiteeToken '<your-pat>'"
    Write-Host ""
    Write-Host "  Gitee PAT 获取:gitee.com/profile/personal_access_tokens(scope `projects` 即可)"
    exit 1
}

# 探测 token 有效性
try {
    $userResp = Invoke-RestMethod -Uri "https://gitee.com/api/v5/user?access_token=$GiteeToken" -Method GET -TimeoutSec 30
    Write-Host "[OK] Gitee token 有效,user=$($userResp.login)" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Gitee token 无效或过期:$_" -ForegroundColor Red
    exit 1
}

# ─── 2. 自动定位 asset 文件 ─────────────────────────────────────────
if (-not $Asset) {
    # 从 tag 推 platform / env / version
    # ship-prod-2026.5.3.1       → Win  prod  2026.5.3.1
    # ship-beta-2026.5.10.1      → Win  beta  2026.5.10.1
    # ship-mac-prod-2026.5.3.1   → Mac  prod  2026.5.3.1
    if ($Tag -match '^ship-(prod|beta)-(.+)$') {
        $platform = "Win"; $envName = $Matches[1]; $version = $Matches[2]
    } elseif ($Tag -match '^ship-mac-(prod|beta)-(.+)$') {
        $platform = "Mac"; $envName = $Matches[1]; $version = $Matches[2]
    } else {
        Write-Host "[ERROR] 无法从 tag '$Tag' 推 platform/env/version,请用 -Asset 手动指定" -ForegroundColor Red
        exit 1
    }

    if ($platform -eq "Win") {
        $suffix = switch ($envName) { 'prod' {''}; 'beta' {'-Beta'}; 'dev' {'-Dev'} }
        $candidate = "packages\branding\installer\Output\DeskFox$suffix-$version-setup.exe"
        if (-not (Test-Path $candidate)) {
            # release-deskfox.yml 是在 GitHub runner build 的;本地可能没有
            # 退路:从 GitHub Release 下载到 D:\tmp
            Write-Host "[INFO] 本地未发现 $candidate,从 GitHub Release 下载..." -ForegroundColor Yellow
            $tmpDir = "D:\tmp\gitee-mirror-$Tag"
            New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
            $gh = Get-Command gh -ErrorAction SilentlyContinue
            if (-not $gh) {
                $gh = "D:\softwares\gh.exe"
                if (-not (Test-Path $gh)) {
                    Write-Host "[ERROR] gh CLI 未找到,无法从 GitHub 下载。请手动下 .exe 后用 -Asset 指定" -ForegroundColor Red
                    exit 1
                }
            }
            & $gh release download $Tag --repo "$GiteeOwner/$GiteeRepo" --dir $tmpDir --clobber 2>&1 | Out-Null
            $candidate = (Get-ChildItem $tmpDir -Filter "*.exe" | Select-Object -First 1).FullName
            if (-not $candidate) {
                Write-Host "[ERROR] GitHub Release 没找到 .exe 附件" -ForegroundColor Red
                exit 1
            }
        }
        $Asset = (Resolve-Path $candidate).Path
    } else {
        Write-Host "[ERROR] Mac asset 自动定位待补,请用 -Asset 指定 .dmg 路径" -ForegroundColor Red
        exit 1
    }
}

if (-not (Test-Path $Asset)) {
    Write-Host "[ERROR] 找不到 asset 文件:$Asset" -ForegroundColor Red
    exit 1
}

$assetItem = Get-Item $Asset
$assetSize = $assetItem.Length
$assetSizeMB = [math]::Round($assetSize / 1MB, 2)
Write-Host "[asset] $($assetItem.Name) ($assetSizeMB MB)"

if ($assetSize -gt 104857600) {
    Write-Host "[ERROR] 文件 $assetSizeMB MB > 100MB Gitee 单文件上限,无法上传" -ForegroundColor Red
    exit 1
}

# ─── 3. 找 Gitee release_id by tag ──────────────────────────────────
Write-Host "[lookup] 在 Gitee 找 tag=$Tag 的 release..."
try {
    $listResp = Invoke-RestMethod `
        -Uri "https://gitee.com/api/v5/repos/$GiteeOwner/$GiteeRepo/releases?access_token=$GiteeToken&per_page=100" `
        -Method GET -TimeoutSec 30
} catch {
    Write-Host "[ERROR] 拉 Gitee releases 列表失败:$_" -ForegroundColor Red
    exit 1
}

$matched = $listResp | Where-Object { $_.tag_name -eq $Tag }
if (-not $matched) {
    Write-Host "[ERROR] Gitee 上找不到 tag=$Tag 的 release。" -ForegroundColor Red
    Write-Host "  确认 release-mirror-gitee-deskfox workflow 已 publish 触发并跑通"
    Write-Host "  (workflow 触发后 ~30 秒 Gitee release 元数据就建好了)"
    exit 1
}
$releaseId = $matched.id
Write-Host "[OK] 找到 Gitee release id=$releaseId" -ForegroundColor Green

# ─── 4. 检查附件是否已存在(去重)─────────────────────────────────
if ($matched.assets) {
    $existing = $matched.assets | Where-Object { $_.name -eq $assetItem.Name }
    if ($existing) {
        Write-Host "[skip] 附件 $($assetItem.Name) 已在 Gitee release(可能上次已跑过)。" -ForegroundColor Yellow
        Write-Host "  Gitee URL: https://gitee.com/$GiteeOwner/$GiteeRepo/releases/tag/$Tag"
        Write-Host "  如要强制重传,先到 Gitee web 删旧附件再跑"
        exit 0
    }
}

# ─── 5. 上传(curl -F 走 multipart,本地 IP 上 Gitee 秒传)─────────
Write-Host "[upload] 上传到 Gitee release_id=$releaseId..."
$startTime = Get-Date

# curl 在 Win 10+ 默认装,走 curl.exe(不是 PS 别名)
$curlExe = "curl.exe"
$uploadUrl = "https://gitee.com/api/v5/repos/$GiteeOwner/$GiteeRepo/releases/$releaseId/attach_files"
$respFile = Join-Path $env:TEMP "gitee-upload-$([guid]::NewGuid().Guid.Substring(0,8)).json"

$curlOut = & $curlExe -s -o $respFile -w "%{http_code}" `
    --connect-timeout 30 --max-time 600 `
    -X POST $uploadUrl `
    -F "access_token=$GiteeToken" `
    -F "file=@$Asset"

$elapsed = ((Get-Date) - $startTime).TotalSeconds
$httpCode = $curlOut.Trim()

Write-Host "[upload done] http=$httpCode elapsed=$([math]::Round($elapsed, 1))s ($([math]::Round($assetSizeMB / $elapsed * 8, 2)) Mbps)"

if ($httpCode -eq "200" -or $httpCode -eq "201") {
    Write-Host ""
    Write-Host "✅ 上传成功!" -ForegroundColor Green
    Write-Host "Gitee release: https://gitee.com/$GiteeOwner/$GiteeRepo/releases/tag/$Tag"
    Remove-Item $respFile -ErrorAction SilentlyContinue
    exit 0
} else {
    Write-Host ""
    Write-Host "❌ 上传失败 http=$httpCode" -ForegroundColor Red
    Write-Host "Gitee response:"
    if (Test-Path $respFile) { Get-Content $respFile }
    Remove-Item $respFile -ErrorAction SilentlyContinue
    exit 1
}
