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
  #define AppVersion "2026.4.29.2"
#endif

#ifndef AppEnv
  #define AppEnv "prod"
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
#define IconFile       "..\src\assets\icons\prod\icon.ico"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputBaseFilename={#OutputBase}-{#AppVersion}-setup
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
