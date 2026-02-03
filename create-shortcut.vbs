' VBScript to create desktop shortcut for Garage Management System
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Get script directory
strScriptPath = objFSO.GetParentFolderName(WScript.ScriptFullName)
strBatFile = strScriptPath & "\start-garage-app.bat"

' Get desktop path
strDesktop = objShell.SpecialFolders("Desktop")

' Create shortcut
Set objShortcut = objShell.CreateShortcut(strDesktop & "\Garage Manager.lnk")
objShortcut.TargetPath = strBatFile
objShortcut.WorkingDirectory = strScriptPath
objShortcut.Description = "Hamdan Garage Management System"
objShortcut.IconLocation = strScriptPath & "\build\icon.ico,0"
objShortcut.Save

WScript.Echo "Desktop shortcut created successfully!" & vbCrLf & vbCrLf & "Look for 'Garage Manager' icon on your desktop."
