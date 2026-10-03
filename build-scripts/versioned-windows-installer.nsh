; Install each EMS Media System release beside other installed releases.
;
; electron-builder derives the NSIS registry identity from the versioned
; Windows appId in versioned-windows-installer.cjs. This hook also changes the
; default program directory while preserving an explicit /D command-line path
; and the location recorded by a reinstall of the same version.
!macro customInit
  ReadRegStr $R9 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R9 == ""
    !insertmacro GetDParameter $R8
    ${If} $R8 == ""
      ${GetParent} "$INSTDIR" $R8
      StrCpy $INSTDIR "$R8\${PRODUCT_NAME} ${VERSION}"
    ${EndIf}
  ${EndIf}
!macroend
