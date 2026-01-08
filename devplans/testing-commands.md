# PowerShell Execution Testing

Run these commands on your Windows system and report back the results exactly as shown.

## Commands to Run

### Test 1: Simple Write-Host
```
powershell -NoProfile -Command "Write-Host 'HelloWorld'"
```

### Test 2: Get-Date
```
powershell -NoProfile -Command "Get-Date"
```

### Test 3: Echo Test
```
powershell -Command "echo test123"
```

### Test 4: Multiple Statements
```
powershell -Command "Write-Host 'First'; Write-Host 'Second'"
```

### Test 5: PS1 File
Create a file `test.ps1` with content:
```
Write-Host 'Hello from PS1'
Get-Date
```
Then run:
```
powershell -ExecutionPolicy Bypass -File test.ps1
```

### Test 6: CMD Wrapper
```
cmd /c powershell -Command "Write-Host 'HelloFromCMD'"
```

## Report Format

For EACH command, tell me:

```
Command: [exact command you ran]
Exit code: [number]
Output: [exact text returned]
Expected: [what should happen]
Actual: [what happened - executed or echoed?]
```

Example:
```
Command: powershell -Command "Write-Host 'Hello'"
Exit code: 0
Output: Hello
Expected: Print "Hello"
Actual: Executed correctly
```

## What I Need

1. Results from all 6 tests above
2. Which methods work (execute correctly)
3. Which methods fail (echo the command instead of executing)
4. Any error messages you see
