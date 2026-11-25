; LockPad NSIS Uninstaller Protection Hook
; Requires the user to enter their master passphrase and confirm permanent data wipe
; before Windows can uninstall LockPad while a vault exists.

!macro NSIS_HOOK_PREUNINSTALL
  IfFileExists "$LOCALAPPDATA\com.lockpad.app\vault\vault.meta" 0 +6
    ExecWait '"$INSTDIR\LockPad.exe" --uninstall-gate' $0
    IntCmp $0 0 +4
      MessageBox MB_OK|MB_ICONSTOP "Desinstalação cancelada: é necessário inserir a frase-chave correta e confirmar o apagamento dos dados do cofre antes de remover o LockPad."
      Abort
!macroend
