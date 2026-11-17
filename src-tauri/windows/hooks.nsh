; What the installer adds besides the app itself, for the user it is installed for,
; and takes away again when it is uninstalled:
;
; - "Open with Logiq Studio" on folders in Explorer: on a folder, and on the empty
;   space inside one.
; - Logiq Studio in the "Open with" list of the source files it edits. It does not
;   become their default program: double-clicking a .html file still opens the
;   browser, a .py file still runs. (.java and .uml files do open in Logiq Studio;
;   those are the file associations in tauri.conf.json.)

!define LOGIQ_PROGID "LogiqStudio.SourceFile"

!macro LOGIQ_OPEN_WITH EXT
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${LOGIQ_PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
!macroend

!macro LOGIQ_OPEN_WITH_REMOVE EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${LOGIQ_PROGID}"
!macroend

!macro LOGIQ_EACH_TYPE DO
  !insertmacro ${DO} "html"
  !insertmacro ${DO} "htm"
  !insertmacro ${DO} "css"
  !insertmacro ${DO} "js"
  !insertmacro ${DO} "mjs"
  !insertmacro ${DO} "ts"
  !insertmacro ${DO} "json"
  !insertmacro ${DO} "md"
  !insertmacro ${DO} "py"
  !insertmacro ${DO} "c"
  !insertmacro ${DO} "h"
  !insertmacro ${DO} "cpp"
  !insertmacro ${DO} "hpp"
  !insertmacro ${DO} "kt"
  !insertmacro ${DO} "php"
  !insertmacro ${DO} "sql"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\Directory\shell\LogiqStudio" "" "Open with Logiq Studio"
  WriteRegStr SHCTX "Software\Classes\Directory\shell\LogiqStudio" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe"
  WriteRegStr SHCTX "Software\Classes\Directory\shell\LogiqStudio\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%V"'
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\LogiqStudio" "" "Open with Logiq Studio"
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\LogiqStudio" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe"
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\LogiqStudio\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%V"'

  WriteRegStr SHCTX "Software\Classes\${LOGIQ_PROGID}" "" "Source file"
  WriteRegStr SHCTX "Software\Classes\${LOGIQ_PROGID}\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\${LOGIQ_PROGID}\shell\open" "" "Open with Logiq Studio"
  WriteRegStr SHCTX "Software\Classes\${LOGIQ_PROGID}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "Logiq Studio"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  !insertmacro LOGIQ_EACH_TYPE LOGIQ_OPEN_WITH
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\Directory\shell\LogiqStudio"
  DeleteRegKey SHCTX "Software\Classes\Directory\Background\shell\LogiqStudio"
  DeleteRegKey SHCTX "Software\Classes\${LOGIQ_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  !insertmacro LOGIQ_EACH_TYPE LOGIQ_OPEN_WITH_REMOVE
!macroend
