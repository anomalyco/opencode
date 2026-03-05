# OPENSACIA Phase 2: Ollama Integration

## Ollama Setup

### Install Ollama

```bash
# macOS
curl -fsSL https://ollama.com/install.sh | sh

# Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows
# Download from https://ollama.com/download
```

### Pull the Model

```bash
ollama pull qwen2.5:7b-instruct-q5_K_M
```

### Start Ollama Server

```bash
ollama serve
```

By default, Ollama runs on `http://localhost:11434`

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENSACIA_OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Ollama API endpoint |

### Config File

Edit `~/.config/opensacia/config.json`:

```json
{
  "provider": {
    "ollama": {
      "options": {
        "baseURL": "http://localhost:11434/v1"
      },
      "models": {
        "qwen2.5:7b-instruct-q5_K_M": {
          "name": "Qwen2.5 7B Instruct (Local)",
          "tools": true,
          "limit": {
            "context": 32768,
            "output": 4096
          }
        }
      }
    }
  }
}
```

## Model Specifications

| Property | Value |
|----------|-------|
| Model | qwen2.5:7b-instruct-q5_K_M |
| Context Window | 32,768 tokens |
| Max Output | 4,096 tokens |
| Tool Calling | Supported |
| Quantization | Q5_K_M |

## Testing

### Verify Ollama is Running

```bash
curl http://localhost:11434/v1/models
```

Expected response:
```json
{
  "object": "list",
  "data": [
    {
      "id": "qwen2.5:7b-instruct-q5_K_M",
      ...
    }
  ]
}
```

### Test with OPENSACIA

```bash
# Start OPENSACIA
bun run packages/opencode/src/index.ts serve
```

Expected logs:
- `Ollama provider connected { baseURL: "http://localhost:11434/v1" }` (if running)
- `Ollama provider configured but not reachable` (if not running)

## Troubleshooting

### "Ollama not reachable" error

- Ensure Ollama is running: `ollama serve`
- Check the endpoint: `curl http://localhost:11434/v1/models`
- Verify the baseURL in config matches Ollama's endpoint

### Model not found

```bash
ollama pull qwen2.5:7b-instruct-q5_K_M
```

### Tool calling not working

Ensure the model configuration has `"tools": true` set.

### Port already in use

```bash
# Change Ollama port
OLLAMA_HOST=0.0.0.0:11435 ollama serve

# Then update config.json baseURL accordingly
```

## Remote Ollama Server

To use Ollama on a remote machine:

```json
{
  "provider": {
    "ollama": {
      "options": {
        "baseURL": "http://remote-server:11434/v1"
      }
    }
  }
}
```

## Integration with OPENSACIA

Once Ollama is configured:

1. The provider is automatically available in sessions
2. Health check runs on OPENSACIA startup
3. Models appear in model selection (if applicable)
4. Tool calling is enabled by default

## Next Steps

After Ollama is running and configured:

- Test with a simple coding task
- Verify tool execution (file read, write, etc.)
- Check logs for Ollama requests/responses
- Adjust context/output limits if needed

## References

- Design Document: `docs/plans/2026-03-05-opensacia-phase2-design.md`
- Implementation Plan: `docs/plans/2026-03-05-opensacia-phase2-implementation.md`
- Ollama Documentation: https://ollama.com/
- Model Card: https://ollama.com/library/qwen2.5:7b-instruct-q5_K_M
