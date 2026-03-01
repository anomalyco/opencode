!macro NSIS_HOOK_POSTINSTALL
  ; Register "Open with OpenCode" context menu for folders
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenCode" "" "Open with OpenCode"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenCode" "Icon" "$INSTDIR\OpenCode.exe"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenCode\command" "" '"$INSTDIR\OpenCode.exe" "opencode://open-project?directory=%V"'

  ; Register for directory background (right-click in empty space inside folder)
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenCode" "" "Open with OpenCode"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenCode" "Icon" "$INSTDIR\OpenCode.exe"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenCode\command" "" '"$INSTDIR\OpenCode.exe" "opencode://open-project?directory=%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Remove context menu entries
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenCode"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenCode"
!macroend
