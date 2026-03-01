# Nate-Alma SSH Control Plane Knowledge

## Deployment Reference

**Active Deployment Path:** `C:\P4NTH30N\OP3NF1XER\nate-alma\deploy-new`

**SSH Keys:**
- Private: `C:\P4NTH30N\OP3NF1XER\nate-alma\ssh_key`
- Public: `C:\P4NTH30N\OP3NF1XER\nate-alma\ssh_key.pub`
- Fingerprint: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJHzZLQF//hAbnC6oEBInFcCVyvH2aMsKHjReHDz+gY/`

## Railway Target

```json
{
  "workspaceId": "thundercube's Projects",
  "projectId": "8dbe6100-4ca7-4eae-ae9a-282cb438b09b",
  "environmentId": "a40e6b07-5528-47c7-b59b-bf4e737a0438",
  "serviceId": "0788bea9-cb97-4d04-b3d3-3180fe8e360f",
  "serviceName": "OpenClaw-Alma-v1",
  "domain": "https://openclaw-alma-v1-production.up.railway.app"
}
```

## Connection Methods

### 1. Railway CLI (Primary)
```powershell
cd C:\P4NTH30N\OP3NF1XER\nate-alma
railway ssh -p "8dbe6100-4ca7-4eae-ae9a-282cb438b09b" `
  -e "a40e6b07-5528-47c7-b59b-bf4e737a0438" `
  -s "0788bea9-cb97-4d04-b3d3-3180fe8e360f" "command"
```

### 2. PowerShell Tools
```powershell
# Command probe
powershell -NoProfile -File tools/railway-ssh.ps1 -Command "openclaw --version"

# Config check
powershell -NoProfile -File tools/openclaw-config-over-ssh.ps1 -Action get -Path channels.telegram

# Pull state snapshot
powershell -NoProfile -File tools/pull-remote-state.ps1 -Label pre-change
```

### 3. SSH Config (Direct)
Host: `nate-alma-railway`
Config: `~/.ssh/config.d/nate-alma`

## Verification Commands

```bash
# Test connectivity
railway ssh ... "echo 'SSH_OK' && openclaw --version"

# Check setup health
curl -s http://localhost:3000/setup/api/status

# Check OpenClaw config
openclaw config get channels.telegram.botToken
```

## Continuity Checkpoint

**Location:** `C:\P4NTH30N\OP3NF1XER\nate-alma\srv\state\continuity.json`

Last updated: 2026-02-25
Status: SSH wired with auto-accept

## Quick Reference

| Task | Command |
|------|---------|
| SSH Probe | `railway ssh -p ... -e ... -s ... "command"` |
| Get Config | `openclaw config get <path>` |
| Set Config | `openclaw config set <path> <value>` |
| Pull State | `tools/pull-remote-state.ps1 -Label <name>` |
| Push Bundle | `tools/push-remote-bundle.ps1 -Bundle <path> -Apply` |

## Decision Linkage

- Related: DECISION_142 (Nate-Alma Governance)
- Pattern: SSH Control Plane (OP3NF1XER/patterns/ssh-control-plane.md)
