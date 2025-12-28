# This script creates the FINAL shortcut that runs the development script.
# Add error handling and validation

try {
    # Check if required files exist
    $devScriptPath = "C:\Users\akink\Desktop\System Tools\Tauri Systen Tools.ps1"
    $iconPath = "C:\Users\akink\Desktop\System Tools\src-tauri\icons\icon.ico"
    
    if (-not (Test-Path $devScriptPath)) {
        Write-Host "ERROR: Tauri Systen Tools.ps1 not found at: $devScriptPath" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    
    if (-not (Test-Path $iconPath)) {
        Write-Host "WARNING: Icon file not found at: $iconPath" -ForegroundColor Yellow
        Write-Host "Using default PowerShell icon instead." -ForegroundColor Yellow
        $iconPath = "powershell.exe,0"
    }
    
    # Create COM object for shortcut
    $shell = New-Object -ComObject WScript.Shell
    
    # Define the path for the new shortcut on the Desktop
    $desktopPath = [System.Environment]::GetFolderPath('Desktop')
    $shortcutPath = Join-Path $desktopPath "Tauri System Tools.lnk"
    
    # Check if shortcut already exists
    if (Test-Path $shortcutPath) {
        Write-Host "Shortcut already exists. Overwriting..." -ForegroundColor Yellow
        Remove-Item $shortcutPath -Force -ErrorAction SilentlyContinue
    }
    
    $shortcut = $shell.CreateShortcut($shortcutPath)
    
    # --- Configure the new shortcut ---
    $shortcut.TargetPath = "powershell.exe"
    $shortcut.Arguments = "-ExecutionPolicy Bypass -NoProfile -File `"$devScriptPath`""
    $shortcut.IconLocation = $iconPath
    $shortcut.WorkingDirectory = "C:\Users\akink\Desktop\System Tools"
    $shortcut.Description = "System Tools geliştirici betiğini çalıştırır."
    
    # Save the shortcut
    $shortcut.Save()
    
    Write-Host "Shortcut created successfully at: $shortcutPath" -ForegroundColor Green
    
    # Provide visual feedback to the user
    $popup = New-Object -ComObject Wscript.Shell
    $null = $popup.Popup("Logolu 'Tauri System Tools' masaüstünüzde başarıyla oluşturuldu!", 3, "İşlem Tamamlandı", 0x40)
    
} catch {
    Write-Host "ERROR: Failed to create shortcut. Details: $_" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}