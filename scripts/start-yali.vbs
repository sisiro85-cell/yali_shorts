Option Explicit

Dim fso, shell, root, pythonExe, npmExe, nodeExe, frontendDir, backendDir, renderWorkerDir, renderWorkerEntry, frontendViteEntry, storageDir, pidFile
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root

pythonExe = fso.BuildPath(root, ".venv\Scripts\python.exe")
If Not fso.FileExists(pythonExe) Then
    pythonExe = "python.exe"
End If
npmExe = "npm.cmd"
nodeExe = "node.exe"
frontendDir = fso.BuildPath(root, "frontend")
backendDir = fso.BuildPath(root, "backend")
renderWorkerDir = fso.BuildPath(root, "render-worker")
renderWorkerEntry = fso.BuildPath(renderWorkerDir, "dist\index.js")
frontendViteEntry = fso.BuildPath(frontendDir, "node_modules\.bin\vite.cmd")
storageDir = fso.BuildPath(root, "storage")
pidFile = fso.BuildPath(storageDir, ".yali-processes.json")
shell.Environment("PROCESS")("YALI_PROJECTS_ROOT") = fso.BuildPath(storageDir, "projects")

If WScript.Arguments.Count > 0 Then
    If LCase(WScript.Arguments(0)) = "/validate" Then
        If Not fso.FolderExists(frontendDir) Then
            WScript.Echo "frontend folder was not found: " & frontendDir
            WScript.Quit 1
        End If
        If Not fso.FolderExists(backendDir) Then
            WScript.Echo "backend folder was not found: " & backendDir
            WScript.Quit 1
        End If
        If Not fso.FileExists(frontendViteEntry) Then
            WScript.Echo "frontend dependencies were not installed: run npm --prefix frontend install"
            WScript.Quit 1
        End If
        If Not fso.FileExists(renderWorkerEntry) Then
            WScript.Echo "render worker is not built: run npm --prefix render-worker run build"
            WScript.Quit 1
        End If
        If Not fso.FileExists(pythonExe) And FindOnPath("python.exe") = "" Then
            WScript.Echo "Python was not found. Create .venv or add python.exe to PATH."
            WScript.Quit 1
        End If
        If FindOnPath("node.exe") = "" Then
            WScript.Echo "Node.js was not found. Add node.exe to PATH."
            WScript.Quit 1
        End If
        If FindOnPath("npm.cmd") = "" Then
            WScript.Echo "npm was not found. Add npm.cmd to PATH."
            WScript.Quit 1
        End If
        If FindOnPath("codex.exe") = "" And FindOnPath("codex.cmd") = "" Then
            WScript.Echo "Warning: Codex CLI was not found on PATH. Codex MCP generation will fail until CODEX_CLI_PATH is configured."
        End If
        WScript.Echo "Yali launcher paths are valid."
        WScript.Quit 0
    End If
End If

Dim backendCommand, frontendCommand, renderCommand, backendPid, frontendPid, renderPid, pidHandle
backendCommand = Quote(pythonExe) & " -m uvicorn --app-dir " & Quote(backendDir) & " yali.api.app:create_app --factory --host 127.0.0.1 --port 8000"
frontendCommand = Quote(npmExe) & " --prefix " & Quote(frontendDir) & " run dev -- --host 127.0.0.1"
renderCommand = Quote(nodeExe) & " " & Quote(renderWorkerEntry)

' WindowStyle 0 hides both the launcher and the child console windows.
backendPid = shell.Run(backendCommand, 0, False)
frontendPid = shell.Run(frontendCommand, 0, False)
renderPid = shell.Run(renderCommand, 0, False)

If Not fso.FolderExists(storageDir) Then fso.CreateFolder(storageDir)
Set pidHandle = fso.CreateTextFile(pidFile, True)
pidHandle.WriteLine "{""backend"": " & backendPid & ", ""frontend"": " & frontendPid & ", ""render"": " & renderPid & "}"
pidHandle.Close

Private Function Quote(value)
    Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function

Private Function FindOnPath(command)
    Dim pathValue, entry, folder, candidate
    FindOnPath = ""
    pathValue = shell.Environment("PROCESS")("Path")
    For Each entry In Split(pathValue, ";")
        folder = Trim(entry)
        If Len(folder) > 0 Then
            candidate = fso.BuildPath(folder, command)
            If fso.FileExists(candidate) Then
                FindOnPath = candidate
                Exit Function
            End If
        End If
    Next
End Function
