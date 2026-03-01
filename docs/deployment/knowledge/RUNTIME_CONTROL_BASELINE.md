# Runtime Control Baseline

Decision link: `DECISION_122`

## Startup Audit Goal

After host reboot, verify command resolution uses controlled runtime paths and versions.

## Path-Drift Guardrail

- Runtime scripts now resolve `knowledge/` from `$PSScriptRoot` rather than hardcoded repo root naming.
- This keeps audit/policy output deterministic even when repository naming drifts.

## Controlled OpenCode Path

- Target executable: `C:/P4NTH30N/OP3NF1XER/opencode-dev/packages/opencode/dist/opencode-windows-x64/bin/opencode.exe`
- Shim locations forced to target:
  - `C:/P4NTH30N/opencode`
  - `C:/P4NTH30N/opencode.cmd`
  - `C:/Users/paulc/AppData/Roaming/npm/opencode`
  - `C:/Users/paulc/AppData/Roaming/npm/opencode.cmd`
  - `C:/Users/paulc/AppData/Roaming/npm/opencode.ps1`

## Controlled Auxiliary CLI Paths

- Wrapper root: `C:/Users/paulc/bin`
- Wrapper commands:
  - `thv.ps1` / `thv.cmd` -> `C:/Users/paulc/AppData/Local/ToolHive/bin/thv.exe`
  - `lms.ps1` / `lms.cmd` -> `C:/Users/paulc/.lmstudio/bin/lms.exe`
  - `rdctl.ps1` / `rdctl.cmd` -> `C:/Program Files/Rancher Desktop/resources/resources/win32/bin/rdctl.exe`

## OpenSSH PATH Policy and Dev Parity

- Runtime PATH policy canonical target for SSH: `C:/Windows/System32/OpenSSH/ssh.exe`.
- Runtime PATH policy helper script: `OP3NF1XER/enforce-runtime-path-policy.ps1`.
- Managed stack assimilation can persist policy with:
  - `powershell -NoProfile -ExecutionPolicy Bypass -File "C:/P4NTH30N/OP3NF1XER/assimilate-managed-stack.ps1" -PersistPathPolicy`
  - machine-level persistence (when elevated):
    - `powershell -NoProfile -ExecutionPolicy Bypass -File "C:/P4NTH30N/OP3NF1XER/assimilate-managed-stack.ps1" -PersistPathPolicy -PersistMachinePathPolicy`
- Runtime audit now includes:
  - PATH policy assertion (`where ssh` first candidate must be Windows OpenSSH).
  - user and machine PATH order assertions (OpenSSH path must not trail Git SSH paths).
  - OpenSSH development parity assertion (`openssh-source` HEAD equals `openssh-dev` HEAD).

## Reboot Verification Commands

- `opencode --version`
- `powershell -NoProfile -Command "opencode --version"`
- `sudo --inline opencode --version`
- `powershell -NoProfile -ExecutionPolicy Bypass -File "C:/P4NTH30N/OP3NF1XER/audit-runtime-control.ps1"`

## Current Baseline Evidence

- `OP3NF1XER/knowledge/runtime-control-audit-2026-02-24T11-34-26.json`
- All runtime checks reported `ok: true`.

## H0UND Artifact Parity Guard (DECISION_129)

- H0UND release artifacts must be runnable from the canonical build path:
  - `C:/Users/paulc/OneDrive/Desktop/build/H0UND/bin/Release/net10.0-windows7.0`
- Required runtime dependency check anchors for startup faults:
  - `MongoDB.Bson.dll`
  - `MongoDB.Driver.dll`
- If startup fails with assembly load errors, verify artifact-path parity first (build output routing + dependency copy behavior) before deeper runtime triage.
