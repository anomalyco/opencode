# OpenFixer Session Learnings - Lynx Installation

**Date:** 2026-02-27  
**Session:** TUIOS + Lynx installation on Windows

---

## Key Learnings

### 1. Read Documentation Before Acting
- When asked to install Lynx with HTTPS support, should have read the documentation first
- Lynx documentation clearly states that SSL version requires OpenSSL DLLs to be selected during install
- Continued trying approaches without understanding the root requirement

### 2. Lynx SSL Requirements (Windows)
- Lynx "new SSL" installer requires OpenSSL DLLs (libssl-1_1.dll, libcrypto-1_1.dll)
- These must be in the same folder as lynx.exe OR in system32
- The installer has an interactive dialog to select the DLLs - cannot be done silently
- Alternative: Download pre-built DLLs from trusted sources

### 3. CLI Limitations
- Could not download files from certain domains (sourceforge.net, raw.githubusercontent.com)
- CLI package managers (winget, choco) may not install the right version of dependencies
- Some tasks require manual intervention

---

## What Was Accomplished
- TUIOS upgraded to v0.6.0
- PATH restored after Lynx install broke it
- Basic Lynx (non-SSL) installed at C:\Users\paulc\bin\

## What Failed
- Lynx HTTPS support - requires manual DLL download and placement
- User had to complete manually

---

## Recommendation for Future Sessions
1. Always read relevant documentation first (README, docs/CONFIG.md, etc.)
2. If installing software with dependencies, understand the dependency chain before starting
3. When CLI fails repeatedly, stop and ask user for manual intervention rather than continuing to try failing approaches
