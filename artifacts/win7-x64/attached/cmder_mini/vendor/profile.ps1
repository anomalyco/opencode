# Init Script for PowerShell
# Created as part of Cmder project
# NOTE: This file must be saved using UTF-8 with BOM encoding for prompt symbol to work correctly.

# !!! THIS FILE IS OVERWRITTEN WHEN CMDER IS UPDATED
# !!! Use "%CMDER_ROOT%\config\user_profile.ps1" to add your own startup commands

$CMDER_INIT_START = Get-Date

# Compatibility with PS major versions <= 2
if (!$PSScriptRoot) {
    $PSScriptRoot = Split-Path $Script:MyInvocation.MyCommand.Path
}

if ($ENV:CMDER_USER_CONFIG) {
    Write-Verbose "CMDER IS ALSO USING INDIVIDUAL USER CONFIG FROM '$ENV:CMDER_USER_CONFIG'!"
}

# We do this for Powershell as Admin Sessions because CMDER_ROOT is not being set.
if (!$ENV:CMDER_ROOT) {
    if ($ENV:ConEmuDir) {
        $ENV:CMDER_ROOT = Resolve-Path($ENV:ConEmuDir + "\..\..")
    } else {
        $ENV:CMDER_ROOT = Resolve-Path($PSScriptRoot + "\..")
    }
}

# Remove trailing '\'
$ENV:CMDER_ROOT = ($ENV:CMDER_ROOT).TrimEnd("\")

# -> recent PowerShell versions include PowerShellGet out of the box
$moduleInstallerAvailable = [bool](Get-Command -Name 'Install-Module' -ErrorAction SilentlyContinue)

# Add Cmder modules directory to the autoload path.
$CmderModulePath = Join-path $PSScriptRoot "psmodules/"

$CmderFunctions  = Join-Path $CmderModulePath "Cmder.ps1"
. $CmderFunctions

if(-not $moduleInstallerAvailable -and -not $env:PSModulePath.Contains($CmderModulePath) ) {
    $env:PSModulePath = $env:PSModulePath.Insert(0, "$CmderModulePath;")
}

$gitVersionVendor = (readVersion -gitPath "$ENV:CMDER_ROOT\vendor\git-for-windows\cmd")
Write-Debug "GIT VENDOR: ${gitVersionVendor}"

# Get user installed Git Version[s] and Compare with vendored if found.
foreach ($git in (Get-Command -ErrorAction SilentlyContinue 'git')) {
    Write-Debug "GIT PATH: {$git.Path}"
    $gitDir = Split-Path -Path $git.Path
    $gitDir = isGitShim -gitPath $gitDir
    $gitVersionUser = (readVersion -gitPath $gitDir)
    Write-Debug "GIT USER: ${gitVersionUser}"

    $useGitVersion = compare_git_versions -userVersion $gitVersionUser -vendorVersion $gitVersionVendor
    Write-Debug "Using Git Version: ${useGitVersion}"

    # Use user installed Git
    if ($null -eq $gitPathUser) {
        if ($gitDir -match '\\mingw32\\bin' -or $gitDir -match '\\mingw64\\bin') {
            $gitPathUser = ($gitDir.subString(0,$gitDir.Length - 12))
        } else {
            $gitPathUser = ($gitDir.subString(0,$gitDir.Length - 4))
        }
    }

    if ($useGitVersion -eq $gitVersionUser) {
        Write-Debug "Using Git Dir: ${gitDir}"
        $ENV:GIT_INSTALL_ROOT = $gitPathUser
        $ENV:GIT_INSTALL_TYPE = 'USER'
        break
    }
}

# User vendored Git.
if ($null -eq $ENV:GIT_INSTALL_ROOT -and $null -ne $gitVersionVendor) {
    $ENV:GIT_INSTALL_ROOT = "$ENV:CMDER_ROOT\vendor\git-for-windows"
    $ENV:GIT_INSTALL_TYPE = 'VENDOR'
}

Write-Debug "GIT_INSTALL_ROOT: ${ENV:GIT_INSTALL_ROOT}"
Write-Debug "GIT_INSTALL_TYPE: ${ENV:GIT_INSTALL_TYPE}"

if ($null -ne $ENV:GIT_INSTALL_ROOT) {
    $env:Path = Configure-Git -gitRoot "$ENV:GIT_INSTALL_ROOT" -gitType $ENV:GIT_INSTALL_TYPE -gitPathUser $gitPathUser
}

if (Get-Command -Name "vim" -ErrorAction SilentlyContinue) {
    New-Alias -name "vi" -value vim
}

if (Get-Module PSReadline -ErrorAction "SilentlyContinue") {
    Set-PSReadlineOption -ExtraPromptLineCount 1
}

# Pre-assign default prompt hooks so the first run of cmder gets a working prompt.
$env:gitLoaded = $null
[ScriptBlock]$PrePrompt = {}
[ScriptBlock]$PostPrompt = {}
[ScriptBlock]$CmderPrompt = {
    # Check if we're currently running under Admin privileges.
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal] $identity
    $adminRole = [Security.Principal.WindowsBuiltInRole]::Administrator
    $color = "White"
    if ($principal.IsInRole($adminRole)) { $color = "Red" }
    $Host.UI.RawUI.ForegroundColor = "White"
    Microsoft.PowerShell.Utility\Write-Host "PS " -NoNewline -ForegroundColor $color
    Microsoft.PowerShell.Utility\Write-Host $pwd.ProviderPath -NoNewLine -ForegroundColor Green
    checkGit($pwd.ProviderPath)
    Microsoft.PowerShell.Utility\Write-Host "`nλ" -NoNewLine -ForegroundColor "DarkGray"
}

# Enhance Path
$env:Path = "$Env:CMDER_ROOT\bin;$Env:CMDER_ROOT\vendor\bin;$env:Path;$Env:CMDER_ROOT"

# Drop *.ps1 files into "$ENV:CMDER_ROOT\config\profile.d"
# to source them at startup.
if (-not (Test-Path -PathType container "$ENV:CMDER_ROOT\config\profile.d")) {
    New-Item -ItemType Directory -Path "$ENV:CMDER_ROOT\config\profile.d"
}

Push-Location $ENV:CMDER_ROOT\config\profile.d
foreach ($x in Get-ChildItem *.psm1) {
    Write-Verbose "Sourcing $x"
    Import-Module $x
}
foreach ($x in Get-ChildItem *.ps1) {
    Write-Verbose "Sourcing $x"
    . $x
}
Pop-Location

# Drop *.ps1 files into "$ENV:CMDER_USER_CONFIG\config\profile.d"
# to source them at startup.  Requires using cmder.exe /C [cmder_user_root_path] argument
if ($ENV:CMDER_USER_CONFIG -ne "" -and (Test-Path "$ENV:CMDER_USER_CONFIG\profile.d")) {
    Push-Location $ENV:CMDER_USER_CONFIG\profile.d
    foreach ($x in Get-ChildItem *.psm1) {
        Write-Verbose "Sourcing $x"
        Import-Module $x
    }
    foreach ($x in Get-ChildItem *.ps1) {
        Write-Verbose "Sourcing $x"
        . $x
    }
    Pop-Location
}

# Renaming to "config\user_profile.ps1" to "user_profile.ps1" for consistency.
if (Test-Path "$env:CMDER_ROOT\config\user-profile.ps1") {
    Rename-Item  "$env:CMDER_ROOT\config\user-profile.ps1" user_profile.ps1
}

$CmderUserProfilePath = Join-Path $env:CMDER_ROOT "config\user_profile.ps1"
if (Test-Path $CmderUserProfilePath) {
    # Create this file and place your own command in there.
    . "$CmderUserProfilePath" # user_profile.ps1 is not a module DO NOT USE import-module
}

if ($ENV:CMDER_USER_CONFIG) {
    # Renaming to "$env:CMDER_USER_CONFIG\user-profile.ps1" to "user_profile.ps1" for consistency.
    if (Test-Path "$env:CMDER_USER_CONFIG\user-profile.ps1") {
        Rename-Item  "$env:CMDER_USER_CONFIG\user-profile.ps1" user_profile.ps1
    }

    $env:Path = "$Env:CMDER_USER_CONFIG\bin;$env:Path"

    $CmderUserProfilePath = Join-Path $ENV:CMDER_USER_CONFIG "user_profile.ps1"
    if (Test-Path $CmderUserProfilePath) {
        . "$CmderUserProfilePath" # user_profile.ps1 is not a module DO NOT USE import-module
    }
}

if (-not (Test-Path $CmderUserProfilePath)) {
    $CmderUserProfilePath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($CmderUserProfilePath)
    Write-Host -NoNewline "`r"
    Write-Host -BackgroundColor Green -ForegroundColor Black "First Run: Creating user startup file: $CmderUserProfilePath"
    Copy-Item "$env:CMDER_ROOT\vendor\user_profile.ps1.default" -Destination $CmderUserProfilePath
}

#
# Prompt Section
#   Users should modify their user_profile.ps1 as it will be safe from updates.
#

# Only set the prompt if it is currently set to the default
# This allows users to configure the prompt in their user_profile.ps1 or config\profile.d\*.ps1
if ( $(Get-Command prompt).Definition -match 'PS \$\(\$executionContext.SessionState.Path.CurrentLocation\)\$\(' -and `
    $(Get-Command prompt).Definition -match '\(\$nestedPromptLevel \+ 1\)\) ";') {

    <#
    This scriptblock runs every time the prompt is returned.
    Explicitly use functions from MS namespace to protect from being overridden in the user session.
    Custom prompt functions are loaded in as constants to get the same behaviour
    #>
    [ScriptBlock]$Prompt = {
        $lastSUCCESS = $?
        $realLastExitCode = $LastExitCode
        $host.UI.RawUI.WindowTitle = Microsoft.PowerShell.Management\Split-Path $pwd.ProviderPath -Leaf
        Microsoft.PowerShell.Utility\Write-Host -NoNewline "$([char]0x200B)`r$([char]0x1B)[K"
        if ($lastSUCCESS -or ($LastExitCode -ne 0)) {
            Microsoft.PowerShell.Utility\Write-Host
        }
        PrePrompt | Microsoft.PowerShell.Utility\Write-Host -NoNewline
        CmderPrompt
        PostPrompt | Microsoft.PowerShell.Utility\Write-Host -NoNewline
        $global:LastExitCode = $realLastExitCode
        return " "
    }

    # Once Created these code blocks cannot be overwritten
    # if (-not $(Get-Command PrePrompt).Options   -match 'Constant') {Set-Item -Path function:\PrePrompt   -Value $PrePrompt   -Options Constant}
    # if (-not $(Get-Command CmderPrompt).Options -match 'Constant') {Set-Item -Path function:\CmderPrompt -Value $CmderPrompt -Options Constant}
    # if (-not $(Get-Command PostPrompt).Options  -match 'Constant') {Set-Item -Path function:\PostPrompt  -Value $PostPrompt  -Options Constant}

    Set-Item -Path function:\PrePrompt   -Value $PrePrompt   -Options Constant
    Set-Item -Path function:\CmderPrompt -Value $CmderPrompt -Options Constant
    Set-Item -Path function:\PostPrompt  -Value $PostPrompt  -Options Constant

    # Functions can be made constant only at creation time
    # ReadOnly at least requires `-force` to be overwritten
    # if (!$(Get-Command Prompt).Options -match 'ReadOnly') {Set-Item -Path function:\prompt  -Value $Prompt  -Options ReadOnly}
    Set-Item -Path function:\prompt  -Value $Prompt  -Options ReadOnly
}

$CMDER_INIT_END = Get-Date

$ElapsedTime = New-TimeSpan -Start $CMDER_INIT_START -End $CMDER_INIT_END

Write-Verbose "Elapsed Time: $($ElapsedTime.TotalSeconds) seconds total"
