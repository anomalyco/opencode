; installer.nsi — Gentle OpenCode Windows Installer
; NSIS 3.x Modern UI 2 installer for the opencode fork
;
; Build with defines:
;   PRODUCT_VERSION   - version string (e.g., "1.17.11")
;   GENTLE_AI_VERSION - gentle-ai release version (e.g., "0.1.0")
;   BINARY_DIR        - path to directory containing opencode.exe
;   LICENSE_FILE      - absolute path to the project LICENSE file
;   PRODUCT_OUTFILE   - output path for the installer exe

!define PRODUCT_NAME "Gentle OpenCode"
!define PRODUCT_PUBLISHER "Gentleman Programming"
!define PRODUCT_URL "https://github.com/ivanfernadezm99/opencode"
!define GENTLE_AI_REPO "Gentleman-Programming/gentle-ai"
!define PRODUCT_REG_ROOT "HKCU"
!define PRODUCT_REG_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"

; ─── Defines with defaults ─────────────────────────────────────────────────

!ifndef PRODUCT_VERSION
  !define PRODUCT_VERSION "0.0.0"
!endif

!ifndef GENTLE_AI_VERSION
  !define GENTLE_AI_VERSION "0.0.0"
!endif

!ifndef BINARY_DIR
  !define BINARY_DIR "."
!endif

!ifndef LICENSE_FILE
  !define LICENSE_FILE "LICENSE"
!endif

!ifndef PRODUCT_OUTFILE
  !define PRODUCT_OUTFILE "opencode-setup.exe"
!endif

; ─── Installer Attributes ──────────────────────────────────────────────────

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "${PRODUCT_OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\opencode"
RequestExecutionLevel admin

BrandingText "${PRODUCT_NAME} ${PRODUCT_VERSION}"

; ─── Includes ──────────────────────────────────────────────────────────────

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "StrFunc.nsh"

; Initialize StrFunc functions (must be at top level, not inside sections)
; StrLoc for installer sections, UnStrLoc for uninstaller sections
${StrLoc}
${UnStrLoc}

; ─── MUI Settings ──────────────────────────────────────────────────────────

!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "Are you sure you want to cancel ${PRODUCT_NAME} ${PRODUCT_VERSION} installation?"

!define MUI_COMPONENTSPAGE_SMALLDESC

; ─── Pages ─────────────────────────────────────────────────────────────────

; Welcome page
!insertmacro MUI_PAGE_WELCOME

; License page — embed the project LICENSE file
!insertmacro MUI_PAGE_LICENSE "${LICENSE_FILE}"

; Install directory selection
!insertmacro MUI_PAGE_DIRECTORY

; Components page (for optional PATH section)
!insertmacro MUI_PAGE_COMPONENTS

; Installation progress
!insertmacro MUI_PAGE_INSTFILES

; Finish page
!define MUI_FINISHPAGE_RUN "$INSTDIR\opencode.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Run ${PRODUCT_NAME}"
!define MUI_FINISHPAGE_NOREBOOT_SUPPORT
!define MUI_FINISHPAGE_LINK "Visit ${PRODUCT_NAME} on GitHub"
!define MUI_FINISHPAGE_LINK_LOCATION "${PRODUCT_URL}"
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; ─── Languages ─────────────────────────────────────────────────────────────

!insertmacro MUI_LANGUAGE "English"

; ─── Version Info ──────────────────────────────────────────────────────────

VIProductVersion "${PRODUCT_VERSION}.0"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "FileDescription" "${PRODUCT_NAME} Installer"
VIAddVersionKey "LegalCopyright" "© ${PRODUCT_PUBLISHER}"
VIAddVersionKey "CompanyName" "${PRODUCT_PUBLISHER}"

; ─── Variables ─────────────────────────────────────────────────────────────

Var GENTLE_AI_INSTALLED

; ─── Sections ──────────────────────────────────────────────────────────────

; ── Main installation (required) ──────────────────────────────────────────

Section "Gentle OpenCode (required)" SEC_MAIN
  SectionIn RO

  SetOutPath "$INSTDIR"

  ; Kill any running opencode process
  DetailPrint "Stopping any running opencode process..."
  nsExec::Exec '"$WINDIR\system32\taskkill.exe" /F /IM opencode.exe 2>NUL'
  Pop $R0

  ; Copy opencode binary
  DetailPrint "Installing opencode..."
  File "${BINARY_DIR}\opencode.exe"

  ; Download gentle-ai
  DetailPrint "Downloading gentle-ai ${GENTLE_AI_VERSION}..."
  NSISdl::download \
    "https://github.com/${GENTLE_AI_REPO}/releases/download/v${GENTLE_AI_VERSION}/gentle-ai_${GENTLE_AI_VERSION}_windows_amd64.zip" \
    "$INSTDIR\gentle-ai.zip"

  Pop $R0
  ${If} $R0 == "success"
    DetailPrint "Extracting gentle-ai..."
    ; Use backtick-quoted NSIS string to avoid " and ' conflicts with PowerShell
    nsExec::ExecToStack `"$WINDIR\system32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "try { Expand-Archive -Path '$INSTDIR\gentle-ai.zip' -DestinationPath '$INSTDIR' -Force; Write-Output 'EXTRACT_OK' } catch { Write-Output 'EXTRACT_FAIL' }"`
    Pop $R0  ; exit code
    Pop $R1  ; stdout

    ${If} $R0 == "0"
      ${If} $R1 == "EXTRACT_OK"
        DetailPrint "gentle-ai downloaded and extracted successfully."
        Delete "$INSTDIR\gentle-ai.zip"
        StrCpy $GENTLE_AI_INSTALLED "1"

        DetailPrint "Configuring gentle-ai for opencode..."
        nsExec::Exec '"$INSTDIR\gentle-ai.exe" install --agent opencode'
      ${Else}
        DetailPrint "Extraction produced unexpected output: $R1"
        Delete "$INSTDIR\gentle-ai.zip"
      ${EndIf}
    ${Else}
      DetailPrint "Extraction failed (exit code $R0)"
      Delete "$INSTDIR\gentle-ai.zip"
    ${EndIf}
  ${Else}
    DetailPrint "Download failed: $R0"
  ${EndIf}

  ; Create Start Menu shortcuts
  DetailPrint "Creating Start Menu shortcuts..."
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" \
    "$INSTDIR\opencode.exe" "" "$INSTDIR\opencode.exe" 0
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall ${PRODUCT_NAME}.lnk" \
    "$INSTDIR\uninstall.exe" "" "$INSTDIR\uninstall.exe" 0

  ; Write uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Add/Remove Programs registry
  DetailPrint "Registering in Add/Remove Programs..."
  WriteRegStr ${PRODUCT_REG_ROOT} "${PRODUCT_REG_KEY}" "DisplayName" \
    "${PRODUCT_NAME} ${PRODUCT_VERSION}"
  WriteRegStr ${PRODUCT_REG_ROOT} "${PRODUCT_REG_KEY}" "UninstallString" \
    '"$INSTDIR\uninstall.exe"'
  WriteRegStr ${PRODUCT_REG_ROOT} "${PRODUCT_REG_KEY}" "QuietUninstallString" \
    '"$INSTDIR\uninstall.exe" /S'
  WriteRegStr ${PRODUCT_REG_ROOT} "${PRODUCT_REG_KEY}" "DisplayVersion" \
    "${PRODUCT_VERSION}"
  WriteRegStr ${PRODUCT_REG_ROOT} "${PRODUCT_REG_KEY}" "DisplayIcon" \
    "$INSTDIR\opencode.exe,0"
  WriteRegStr ${PRODUCT_REG_ROOT} "${PRODUCT_REG_KEY}" "Publisher" \
    "${PRODUCT_PUBLISHER}"
  WriteRegStr ${PRODUCT_REG_ROOT} "${PRODUCT_REG_KEY}" "URLInfoAbout" \
    "${PRODUCT_URL}"
  WriteRegStr ${PRODUCT_REG_ROOT} "${PRODUCT_REG_KEY}" "HelpLink" \
    "${PRODUCT_URL}/discussions"
  WriteRegStr ${PRODUCT_REG_ROOT} "${PRODUCT_REG_KEY}" "InstallLocation" \
    "$INSTDIR"
  WriteRegDWORD ${PRODUCT_REG_ROOT} "${PRODUCT_REG_KEY}" "NoModify" 1
  WriteRegDWORD ${PRODUCT_REG_ROOT} "${PRODUCT_REG_KEY}" "NoRepair" 1
  WriteRegDWORD ${PRODUCT_REG_ROOT} "${PRODUCT_REG_KEY}" "EstimatedSize" 0

  DetailPrint "Installation complete."
SectionEnd


; ── Add to PATH (optional) ────────────────────────────────────────────────

Section "Add to user PATH" SEC_PATH
  SectionIn 1  ; user can deselect

  DetailPrint "Adding $INSTDIR to user PATH..."
  Push "$INSTDIR"
  Call AddToPath

  ; Notify Windows that environment changed
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000

  DetailPrint "Added $INSTDIR to user PATH. Restart command prompt to take effect."
SectionEnd

LangString DESC_SEC_MAIN ${LANG_ENGLISH} \
  "Installs the ${PRODUCT_NAME} binary and the gentle-ai agent framework. Required."
LangString DESC_SEC_PATH ${LANG_ENGLISH} \
  "Adds the installation directory to the user PATH so opencode and gentle-ai are available from any command prompt."

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_MAIN} $(DESC_SEC_MAIN)
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_PATH} $(DESC_SEC_PATH)
!insertmacro MUI_FUNCTION_DESCRIPTION_END


; ─── Functions ─────────────────────────────────────────────────────────────

; ── .onInit — check for existing install ──────────────────────────────────

Function .onInit
  ; Check if already installed
  ReadRegStr $R0 ${PRODUCT_REG_ROOT} "${PRODUCT_REG_KEY}" "UninstallString"
  ${If} $R0 != ""
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "${PRODUCT_NAME} ${PRODUCT_VERSION} is already installed.$\r$\n\
       Do you want to uninstall the existing version first?" \
      IDYES UninstallExisting IDNO AbortInstall
    UninstallExisting:
      ; Run existing uninstaller silently
      nsExec::Exec '"$INSTDIR\uninstall.exe" /S _?=$INSTDIR'
      Pop $R0
    AbortInstall:
  ${EndIf}
FunctionEnd


; ── .onInstSuccess — post-install messages ────────────────────────────────

Function .onInstSuccess
  ${If} $GENTLE_AI_INSTALLED != "1"
    MessageBox MB_OK|MB_ICONINFORMATION \
      "gentle-ai could not be downloaded or installed automatically.$\r$\n$\r$\n\
       You can install it manually:$\r$\n\
       1. Visit: https://github.com/${GENTLE_AI_REPO}/releases/latest$\r$\n\
        2. Download the Windows zip and extract to:$\r$\n\
          $INSTDIR$\r$\n\
       3. Run: gentle-ai install --agent opencode"
  ${EndIf}
FunctionEnd


; ── AddToPath — add a directory to HKCU Environment PATH ──────────────────
; Stack: top = directory to add (e.g., "C:\Program Files\opencode")
; No return value. PATH is modified only if the directory is not already
; present (case-insensitive comparison).

Function AddToPath
  Exch $R0              ; directory to add
  Push $R1              ; original PATH string (re-read when needed)
  Push $R2              ; working copy of PATH
  Push $R3              ; current PATH entry
  Push $R4              ; temp: semicolon position / comparison result
  Push $R5              ; normalized directory (with trailing \ for match target)
  Push $R6              ; found flag ("0" or "1")

  ; Normalize the directory to append "\" for comparison
  StrCpy $R5 $R0
  StrCpy $R4 $R5 "" -1
  ${If} $R4 != "\"
    StrCpy $R5 "$R5\"
  ${EndIf}

  ReadRegStr $R1 HKCU "Environment" "PATH"

  ; If PATH is empty, just set it
  ${If} $R1 == ""
    WriteRegExpandStr HKCU "Environment" "PATH" "$R5"
    Goto AddToPath_end
  ${EndIf}

  StrCpy $R6 "0"
  StrCpy $R2 $R1

  ; Iterate through each PATH entry
  ${Do}
    ${StrLoc} $R4 $R2 ";" ">"
    ${If} $R4 == ""
      ; Last entry
      StrCpy $R3 $R2
      StrCpy $R2 ""
    ${Else}
      ; Entry before the first semicolon
      IntOp $R4 $R4 - 1         ; StrLoc returns 1-based, convert to 0-based
      StrCpy $R3 $R2 $R4
      IntOp $R4 $R4 + 1
      StrCpy $R2 $R2 "" $R4    ; advance working copy past this entry
    ${EndIf}

    ; Normalize entry: remove trailing backslash for fair comparison
    StrCpy $R4 $R3 "" -1
    ${If} $R4 == "\"
      StrCpy $R3 $R3 -1
    ${EndIf}

    ; Compare case-insensitively via Win32 API
    System::Call "kernel32::lstrcmpiW(w '$R3', w '$R5') i .R4"
    ${If} $R4 == 0
      StrCpy $R6 "1"
      ${ExitDo}
    ${EndIf}

    ${If} $R2 == ""
      ${ExitDo}
    ${EndIf}
  ${Loop}

  ${If} $R6 == "0"
    ; Re-read PATH in case of concurrent changes (rare but safe)
    ReadRegStr $R1 HKCU "Environment" "PATH"
    ${If} $R1 != ""
      WriteRegExpandStr HKCU "Environment" "PATH" "$R1;$R5"
    ${Else}
      WriteRegExpandStr HKCU "Environment" "PATH" "$R5"
    ${EndIf}
  ${EndIf}

AddToPath_end:
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd


; ── RemoveFromPath (uninstaller) — remove a directory from HKCU PATH ──────
; Stack: top = directory to remove
; Returns: cleaned PATH (top of stack) or "" if PATH becomes empty

Function un.RemoveFromPath
  Exch $R0              ; directory to remove
  Push $R1              ; original PATH
  Push $R2              ; working copy
  Push $R3              ; current entry
  Push $R4              ; semicolon position / comparison result
  Push $R5              ; normalized directory (without trailing \ for comparison)
  Push $R6              ; result accumulator
  Push $R7              ; temp for normalization

  ; Normalize: directory to remove with trailing \, then strip it for comparison
  StrCpy $R5 $R0
  StrCpy $R7 $R5 "" -1
  ${If} $R7 != "\"
    StrCpy $R5 "$R5\"
  ${EndIf}
  StrCpy $R5 $R5 -1    ; remove trailing backslash for clean comparison

  ReadRegStr $R1 HKCU "Environment" "PATH"
  ${If} $R1 == ""
    Goto RemoveFromPath_ret
  ${EndIf}

  StrCpy $R6 ""
  StrCpy $R2 $R1

  ${Do}
    ${UnStrLoc} $R4 $R2 ";" ">"
    ${If} $R4 == ""
      StrCpy $R3 $R2
      StrCpy $R2 ""
    ${Else}
      IntOp $R4 $R4 - 1
      StrCpy $R3 $R2 $R4
      IntOp $R4 $R4 + 1
      StrCpy $R2 $R2 "" $R4
    ${EndIf}

    ; Normalize entry: remove trailing backslash
    StrCpy $R4 $R3 "" -1
    ${If} $R4 == "\"
      StrCpy $R3 $R3 -1
    ${EndIf}

    ; Case-insensitive comparison
    System::Call "kernel32::lstrcmpiW(w '$R3', w '$R5') i .R4"
    ${If} $R4 != 0
      ; Keep this entry
      ${If} $R6 == ""
        StrCpy $R6 $R3
      ${Else}
        StrCpy $R6 "$R6;$R3"
      ${EndIf}
    ${EndIf}

    ${If} $R2 == ""
      ${ExitDo}
    ${EndIf}
  ${Loop}

  ${If} $R6 == ""
    DeleteRegValue HKCU "Environment" "PATH"
  ${Else}
    WriteRegExpandStr HKCU "Environment" "PATH" "$R6"
  ${EndIf}

RemoveFromPath_ret:
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0               ; return cleaned PATH on stack
FunctionEnd


; ─── Uninstaller Section ───────────────────────────────────────────────────

Section "Uninstall"
  ; Remove binaries
  DetailPrint "Removing files..."
  Delete "$INSTDIR\opencode.exe"
  Delete "$INSTDIR\gentle-ai.exe"
  Delete "$INSTDIR\gentle-ai.zip"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  ; Remove Start Menu shortcuts
  DetailPrint "Removing Start Menu shortcuts..."
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall ${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"

  ; Remove from user PATH
  DetailPrint "Removing from user PATH..."
  Push "$INSTDIR"
  Call un.RemoveFromPath
  Pop $R0

  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000

  ; Remove registry keys
  DetailPrint "Removing registry entries..."
  DeleteRegKey ${PRODUCT_REG_ROOT} "${PRODUCT_REG_KEY}"

  DetailPrint "Uninstallation complete."
SectionEnd
