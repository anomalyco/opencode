# Conatus Headless Server Connection Guide

## Quick Reference

### On the Server (inside tmux via mosh/tailscale)

```bash
# Start tmux session
tmux new -s conatus

# Set password (REQUIRED for security)
export OPENCODE_SERVER_PASSWORD="your-secure-password"

# Start headless server
cd /home/bryan/projects/opencode-analysis/packages/opencode
bun run dev serve --port 4198

# Detach: Ctrl+B, D
# Reattach later: tmux attach -t conatus
```

### From Any Client (local or remote)

```bash
# Set same password
export OPENCODE_SERVER_PASSWORD="your-secure-password"

# Attach to remote server via Tailscale
cd /home/bryan/projects/opencode-analysis/packages/opencode
bun run dev attach http://<tailscale-hostname>:4198

# Or use web interface
# Navigate to: http://<tailscale-hostname>:4198
```

## Authentication Comparison

| Aspect | Claude Code | Conatus |
|--------|-------------|---------|
| **Model** | claude-opus-4-5-20251101 | claude-opus-4-5-20251101 |
| **Auth** | Claude Code subscription | Anthropic OAuth (your account) |
| **Credentials** | Automatic | ~/.local/share/opencode/auth.json |
| **Billing** | Claude Code sub | Your Anthropic account |

## Your Existing Credentials

Your `~/.local/share/opencode/auth.json` has valid OAuth for:
- Anthropic (expires Jan 2026)
- Google
- GitHub Copilot
- Groq, Cerebras, OpenRouter, DeepSeek, Venice
- Vultr, RunPod

All providers work immediately with conatus.

## Full Workflow Example

```bash
# 1. From local machine, connect to server via tailscale
mosh bryan@<tailscale-hostname>

# 2. Start conatus in tmux
tmux new -s conatus
export OPENCODE_SERVER_PASSWORD="secure-pass"
cd ~/projects/opencode-analysis/packages/opencode
bun run dev serve --port 4198
# Ctrl+B, D to detach
# exit mosh

# 3. From local machine, attach to the running server
export OPENCODE_SERVER_PASSWORD="secure-pass"
cd ~/projects/opencode-analysis/packages/opencode
bun run dev attach http://<tailscale-hostname>:4198
```

## Using Specific Models

```bash
# Use your Anthropic OAuth
bun run dev -m anthropic/claude-opus-4-5-20251101

# Use Vultr inference
bun run dev -m vultr-inference/kimi-k2-instruct

# Use velocity router
bun run dev -m velocity/fast
```
