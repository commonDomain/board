Option Explicit
Dim shell, fso, scriptPath, command, result
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "restart-desktop-ui.ps1")
command = """" & shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe") & """ -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """"
On Error Resume Next
result = shell.Run(command, 0, True)
If Err.Number <> 0 Then
    shell.Popup "Unable to launch Museboard restart: " & Err.Description, 0, "Museboard", 4112
End If
