# Tasks: Implement installation directory selection in the install script

The install script at `install` hardcodes `INSTALL_DIR=$HOME/.opencode/bin` (line 71).
The README already documents a priority order (OPENCODE_INSTALL_DIR > XDG_BIN_DIR > $HOME/bin > $HOME/.opencode/bin).
The script must be updated to match the documented behavior.

## Task 1: Implement OPENCODE_INSTALL_DIR env var support
- In `install`, replace the hardcoded `INSTALL_DIR=$HOME/.opencode/bin` on line 71 with a priority-based resolution
- First check `$OPENCODE_INSTALL_DIR`; if set, use it as `INSTALL_DIR`
- Update the `usage()` function to mention `OPENCODE_INSTALL_DIR` as an environment variable option
  - Validation: `grep -q 'OPENCODE_INSTALL_DIR' install`

## Task 2: Add XDG_BIN_DIR and $HOME/bin fallbacks
- After checking `OPENCODE_INSTALL_DIR`, check `$XDG_BIN_DIR`; if set, use it
- If neither env var is set, prefer `$HOME/bin` if it exists (or can be created), fall back to `$HOME/.opencode/bin`
- The mkdir on line 72 must still succeed with the resolved directory
  - Validation: `grep -q 'XDG_BIN_DIR' install && grep -q 'HOME/bin' install`

## Task 3: Verify all INSTALL_DIR usages still work
- Confirm every reference to `INSTALL_DIR` (lines 71, 346-347, 353-354, 417-438, 445-446) still works with the new resolution logic
- The PATH modification logic must use the correct resolved directory
  - Validation: `bash -n install` (syntax check passes)
