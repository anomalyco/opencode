; DeskFox installer — Inno Setup 6 script
; 版本号规则: YYYY.M.D.N (年.月.日.当天第几版,N 从 1 开始)
; 由 packages/branding/scripts/bump-installer-version.ps1 自动维护本行 AppVersion
; 也可命令行 override: iscc /DAppVersion=2026.4.29.2 DeskFox.iss
;
; 三档环境(2026-04-30 起,见 docs/governance/应用身份-命名规则.md)
;   AppEnv 默认为 prod,可通过 ISCC /DAppEnv=dev|beta|prod 切换
;   产物: Output\DeskFox[-Beta|-Dev]-<version>-setup.exe
;   AppId 三档独立 GUID → 控制面板"应用与功能"识别成 3 个独立 app,可同机共存

#ifndef AppVersion
  #define AppVersion "2026.5.25.1"
#endif

#ifndef AppEnv
  #define AppEnv "prod"
#endif

; FORK: AppVersion 可能含 env suffix(例 "2026.5.21.1-dev")— Inno Setup VersionInfoVersion 必须 N.N.N.N
; 数字格式,此处剥后缀给 VersionInfoVersion 用,人类可读 AppVersion 保留完整字符串(含后缀)
; [feat: installer-version-env-suffix] 2026-05-21
#if Pos("-", AppVersion) > 0
  #define NumericAppVersion Copy(AppVersion, 1, Pos("-", AppVersion) - 1)
#else
  #define NumericAppVersion AppVersion
#endif

; 三档身份 — AppId 一旦发布禁止改,改了等于换新 app,装新版不会替换旧版
#if AppEnv == "prod"
  #define AppId          "{{F9F6F6C5-D865-468C-BCE5-BF0ECA24A763}"
  #define AppName        "DeskFox"
  #define OutputBase     "DeskFox"
#elif AppEnv == "beta"
  #define AppId          "{{86413DCA-EA81-415A-A309-473EBFD78990}"
  #define AppName        "DeskFox Beta"
  #define OutputBase     "DeskFox-Beta"
#elif AppEnv == "dev"
  #define AppId          "{{4C5D29F2-3BBB-49A2-B248-B74B716F8EA1}"
  #define AppName        "DeskFox Dev"
  #define OutputBase     "DeskFox-Dev"
#else
  #error Unknown AppEnv. Use prod | beta | dev.
#endif

#define AppPublisher   "DeskFox"
#define AppExeName     "DeskFox.exe"
#define ReleaseDir     "..\..\desktop\src-tauri\target\release"
; IconFile 按 AppEnv 走,跟 AppId/AppName 三档身份一致 — 否则 dev/beta build 时会找不到 prod 的 icon.ico
; (icon.ico 由 apply-icons.ps1 -Env <env> 现场生成到对应 env 子目录,被 .gitignore 不进 git)
#define IconFile       "..\src\assets\icons\" + AppEnv + "\icon.ico"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
; FORK: 显式 VersionInfoVersion 跳过后缀,N.N.N.N 数字格式 [feat: installer-version-env-suffix] 2026-05-21
VersionInfoVersion={#NumericAppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; FORK: 文件名用 NumericAppVersion(strip env suffix),避免 dev/beta 双重后缀冗余
; (例:OutputBase=DeskFox-Dev + AppVersion=2026.5.21.1-dev 旧模板出 "DeskFox-Dev-2026.5.21.1-dev-setup.exe" 双重 -dev;
;  现模板出 "DeskFox-Dev-2026.5.21.1-setup.exe")。Tier 1 prod 不变(prod 本就无后缀)。
; 详 docs/governance/版本号与发布渠道规范.md §四 [feat: installer-naming-cleanup] 2026-05-21
OutputBaseFilename={#OutputBase}-{#NumericAppVersion}-setup
OutputDir=Output
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\{#AppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; 不签名 — SmartScreen 警告是预期成本(详见 1-spec.md)

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinese"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce

[Files]
Source: "{#ReleaseDir}\{#AppExeName}";       DestDir: "{app}"; Flags: ignoreversion
Source: "{#ReleaseDir}\opencode-cli.exe";    DestDir: "{app}"; Flags: ignoreversion
Source: "{#ReleaseDir}\opencode_lib.dll";    DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
; 飞书桥接 plugin bundle(2026-05-10 加,feishu-bridge-ship-packaging Win Inno Setup follow-up)
;   Mac 端经 tauri.conf.json bundle.resources 走 NSIS 打入 .app/.exe;Win 端走 Inno Setup
;   独立配置,需在 [Files] 显式列。runtime 由 feishu_plugin_install.rs 注入 user opencode 配置。
Source: "{#ReleaseDir}\plugin\feishu-bridge\package.json";    DestDir: "{app}\plugin\feishu-bridge";      Flags: ignoreversion
Source: "{#ReleaseDir}\plugin\feishu-bridge\dist\plugin.js";  DestDir: "{app}\plugin\feishu-bridge\dist"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}";        Filename: "{app}\{#AppExeName}"
Name: "{group}\卸载 {#AppName}";   Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}";  Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[Code]
function IsWebView2Installed: Boolean;
var
  Version: String;
begin
  Result :=
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version);
  if Result and (Version <> '') and (Version <> '0.0.0.0') then
    Result := True
  else
    Result := False;
end;

function InitializeSetup: Boolean;
begin
  Result := True;
  if not IsWebView2Installed then
  begin
    if MsgBox(
      'DeskFox 需要 Microsoft Edge WebView2 Runtime,本机未检测到。' + #13#10 + #13#10 +
      'Win10/11 通常预装。如果缺失,请先访问以下链接下载安装:' + #13#10 +
      'https://developer.microsoft.com/microsoft-edge/webview2/' + #13#10 + #13#10 +
      '现在仍要继续安装 DeskFox 吗?',
      mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
  end;
end;
