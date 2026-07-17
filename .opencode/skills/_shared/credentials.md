# Credential Management for Skills

All skills in gentle-opencode use `opencode-cred` for secure credential storage.
Credentials NEVER pass through AI context.

## How Skills Should Integrate

1. **Check credentials** via `opencode-cred get <service>`
2. **If missing**, the orchestrator calls `opencode-cred serve <service>` to open the browser form
3. **Scripts** read credential files directly from `~/.config/opencode/credentials/<service>.cred`

## Security Rules

| Practice | Status |
|----------|--------|
| Credentials in AI chat | ❌ NEVER |
| Credentials in bash args | ❌ NEVER |
| Credentials in env vars (for scripts) | ✅ OK (set by user, not AI) |
| Credential files (0600) | ✅ OK (read by scripts, not AI) |
| Browser form (localhost) | ✅ OK (user types directly) |

## For Skill Developers

Your skill's SKILL.md should tell the orchestrator:

```
## Credential Check

Before any credential-dependent operation:
1. Run `opencode-cred get <service>` to check if stored
2. If not found → orchestrator opens browser form via `opencode-cred serve <service>`
3. Script reads from `~/.config/opencode/credentials/<service>.cred`
4. NEVER ask for credentials in chat
```

## Available Services

| Service | Used By | File |
|---------|---------|------|
| `redmine` | redmine-time-entries | `~/.config/opencode/credentials/redmine.cred` |
