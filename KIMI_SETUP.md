# OpenKimi Setup Guide

## Overview

OpenKimi connects to Kimi K2.6 through the **Kimi CLI ACP bridge**, just like the main OpenCode app.

## Prerequisites

1. **Kimi CLI installed** (usually at `~/.kimi-code/bin/kimi`)
2. **Logged in to Kimi CLI** (run `kimi login` if not already logged in)
3. **Python virtual environment** with bridge dependencies (FastAPI, etc.)

## Setup Steps

### 1. Ensure Kimi CLI is in PATH

```bash
# Create symlink (one-time setup)
mkdir -p ~/bin
ln -sf ~/.kimi-code/bin/kimi ~/bin/kimi

# Add to PATH
export PATH="$HOME/bin:$PATH"

# Verify
which kimi
kimi --version
```

### 2. Start the ACP Bridge

The bridge translates between OpenAI API format and Kimi ACP protocol.

```bash
cd /Users/julien/Documents/Odysseus
source venv/bin/activate
python3 scripts/kimi_acp_openai_bridge.py --host 127.0.0.1 --port 8767 --work-dir /Users/julien/Documents/Odysseus
```

Or run in background:
```bash
cd /Users/julien/Documents/Odysseus
source venv/bin/activate
nohup python3 scripts/kimi_acp_openai_bridge.py --host 127.0.0.1 --port 8767 --work-dir /Users/julien/Documents/Odysseus > /tmp/kimi-bridge.log 2>&1 &
```

### 3. Test the Bridge

```bash
curl http://127.0.0.1:8767/v1/models
```

Should return:
```json
{"object":"list","data":[{"id":"kimi-code/kimi-for-coding",...}]}
```

### 4. Test Chat

```bash
curl http://127.0.0.1:8767/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "kimi-code/kimi-for-coding",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### 5. Start OpenKimi

```bash
cd /Users/julien/Documents/Documents\ -\ Julien\'s\ MacBook\ Air/OpenCode-Kimi/openkimi
./start-openkimi.sh
```

## Architecture

```
OpenKimi Desktop App
    ↓ HTTP (OpenAI-compatible)
Local Bridge (127.0.0.1:8767)
    ↓ stdio (ACP protocol)
Kimi CLI (`kimi acp`)
    ↓ OAuth / API
Kimi K2.6 Service
```

## Configuration

The provider is pre-configured to connect to `http://127.0.0.1:8767`.

Available models:
- `kimi-code/kimi-for-coding` - Standard mode
- `kimi-code/kimi-for-coding,thinking` - With reasoning

## Troubleshooting

### "Kimi ACP bridge failed: [Errno 2] No such file or directory: 'kimi'"

**Solution:** Ensure `kimi` is in PATH:
```bash
export PATH="$HOME/.kimi-code/bin:$PATH"
```

### "Connection refused" to 127.0.0.1:8767

**Solution:** Start the bridge:
```bash
cd /Users/julien/Documents/Odysseus
source venv/bin/activate
python3 scripts/kimi_acp_openai_bridge.py --host 127.0.0.1 --port 8767
```

### "Invalid Authentication"

**Solution:** Login to Kimi CLI:
```bash
kimi login
```

## Notes

- No API key needed in OpenKimi config (authentication handled by Kimi CLI)
- The bridge uses the same OAuth session as `kimi login`
- Context window: 256K tokens
- Supports reasoning, image input, video input
