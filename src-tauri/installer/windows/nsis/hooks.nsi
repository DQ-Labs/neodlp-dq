!macro NSIS_HOOK_POSTINSTALL
  ; Add entry for automatic startup with Windows
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}" "$\"$INSTDIR\neodlp-dq.exe$\" --hidden"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Remove the Registry entries
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
!macroend
