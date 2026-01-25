# OpenAI Realtime API Reference

This document summarizes the OpenAI Realtime API as it relates to our integration.

## Connection

**Endpoint**: `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview`

**Headers**:
```
Authorization: Bearer <API_KEY>
OpenAI-Beta: realtime=v1
```

## Audio Format

| Direction | Format | Sample Rate | Channels | Encoding |
|-----------|--------|-------------|----------|----------|
| Input | PCM16 | 24kHz | Mono | base64 |
| Output | PCM16 | 24kHz | Mono | base64 |

Also supported: G.711 (µ-law and A-law) for telephony.

## Session Configuration

Sent via `session.update` after connection:

```json
{
  "type": "session.update",
  "session": {
    "modalities": ["text", "audio"],
    "voice": "alloy",
    "instructions": "You are a helpful assistant.",
    "input_audio_format": "pcm16",
    "output_audio_format": "pcm16",
    "input_audio_transcription": {
      "model": "whisper-1"
    },
    "turn_detection": {
      "type": "server_vad",
      "threshold": 0.5,
      "prefix_padding_ms": 300,
      "silence_duration_ms": 500,
      "create_response": true
    },
    "tools": [...],
    "temperature": 0.8,
    "max_response_output_tokens": "inf"
  }
}
```

### Voice Options

| Voice | Description |
|-------|-------------|
| `alloy` | Neutral, balanced |
| `echo` | Warm, conversational |
| `shimmer` | Clear, expressive |
| `ash` | Soft, calm |
| `ballad` | Gentle, melodic |
| `coral` | Bright, friendly |
| `sage` | Wise, measured |
| `verse` | Dynamic, engaging |

### Turn Detection

**Server VAD** (recommended):
```json
{
  "type": "server_vad",
  "threshold": 0.5,           // Speech detection sensitivity (0.0-1.0)
  "prefix_padding_ms": 300,   // Audio to include before speech start
  "silence_duration_ms": 500, // Silence duration to end turn
  "create_response": true     // Auto-trigger response on turn end
}
```

**Manual** (push-to-talk):
```json
{
  "type": "none"
}
```

---

## Client → Server Events

### Audio Input

**Append audio chunk**:
```json
{
  "type": "input_audio_buffer.append",
  "audio": "<base64_pcm16_data>"
}
```

**Commit audio** (manual VAD only):
```json
{
  "type": "input_audio_buffer.commit"
}
```

**Clear audio buffer**:
```json
{
  "type": "input_audio_buffer.clear"
}
```

### Session Control

**Update session**:
```json
{
  "type": "session.update",
  "session": {
    "voice": "echo",
    "temperature": 0.6
  }
}
```

### Response Control

**Create response** (manual trigger):
```json
{
  "type": "response.create",
  "response": {
    "modalities": ["text", "audio"]
  }
}
```

**Cancel response** (interrupt):
```json
{
  "type": "response.cancel"
}
```

### Tool Results

**Send function output**:
```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "function_call_output",
    "call_id": "call_abc123",
    "output": "{\"result\": \"success\"}"
  }
}
```

Then trigger continuation:
```json
{
  "type": "response.create"
}
```

---

## Server → Client Events

### Session Events

**Session created**:
```json
{
  "type": "session.created",
  "session": { ... }
}
```

**Session updated**:
```json
{
  "type": "session.updated",
  "session": { ... }
}
```

### VAD Events

**Speech started**:
```json
{
  "type": "input_audio_buffer.speech_started",
  "audio_start_ms": 1500,
  "item_id": "item_abc"
}
```

**Speech stopped**:
```json
{
  "type": "input_audio_buffer.speech_stopped",
  "audio_end_ms": 3200,
  "item_id": "item_abc"
}
```

**Audio committed**:
```json
{
  "type": "input_audio_buffer.committed",
  "previous_item_id": "item_xyz",
  "item_id": "item_abc"
}
```

### Transcription Events

**User transcription completed**:
```json
{
  "type": "conversation.item.input_audio_transcription.completed",
  "item_id": "item_abc",
  "content_index": 0,
  "transcript": "What is the weather like?"
}
```

### Response Events

**Response created**:
```json
{
  "type": "response.created",
  "response": {
    "id": "resp_abc",
    "status": "in_progress",
    "output": []
  }
}
```

**Audio delta** (streaming):
```json
{
  "type": "response.audio.delta",
  "response_id": "resp_abc",
  "item_id": "item_xyz",
  "output_index": 0,
  "content_index": 0,
  "delta": "<base64_audio_chunk>"
}
```

**Audio done**:
```json
{
  "type": "response.audio.done",
  "response_id": "resp_abc",
  "item_id": "item_xyz",
  "output_index": 0,
  "content_index": 0
}
```

**Audio transcript delta**:
```json
{
  "type": "response.audio_transcript.delta",
  "response_id": "resp_abc",
  "item_id": "item_xyz",
  "output_index": 0,
  "content_index": 0,
  "delta": "The weather"
}
```

**Audio transcript done**:
```json
{
  "type": "response.audio_transcript.done",
  "response_id": "resp_abc",
  "item_id": "item_xyz",
  "output_index": 0,
  "content_index": 0,
  "transcript": "The weather is sunny and 72 degrees."
}
```

**Response done**:
```json
{
  "type": "response.done",
  "response": {
    "id": "resp_abc",
    "status": "completed",
    "usage": {
      "total_tokens": 150,
      "input_tokens": 50,
      "output_tokens": 100,
      "input_token_details": {
        "text_tokens": 20,
        "audio_tokens": 30,
        "cached_tokens": 0
      },
      "output_token_details": {
        "text_tokens": 40,
        "audio_tokens": 60
      }
    }
  }
}
```

### Function Calling Events

**Function call arguments streaming**:
```json
{
  "type": "response.function_call_arguments.delta",
  "response_id": "resp_abc",
  "item_id": "item_xyz",
  "output_index": 0,
  "call_id": "call_123",
  "delta": "{\"path\": \"/ho"
}
```

**Function call complete**:
```json
{
  "type": "response.function_call_arguments.done",
  "response_id": "resp_abc",
  "item_id": "item_xyz",
  "output_index": 0,
  "call_id": "call_123",
  "name": "read_file",
  "arguments": "{\"path\": \"/home/user/config.json\"}"
}
```

### Error Events

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "code": "invalid_value",
    "message": "Invalid audio format",
    "param": "input_audio_format",
    "event_id": "evt_abc"
  }
}
```

---

## Pricing (as of 2025)

| Type | Cost |
|------|------|
| Audio input | $0.06 / minute (~100 tokens/second) |
| Audio output | $0.24 / minute (~200 tokens/second) |
| Text input | Standard GPT-4o pricing |
| Text output | Standard GPT-4o pricing |

**Note**: Audio tokens are significantly more expensive than text tokens. A 1-minute conversation could cost ~$0.30.

---

## Rate Limits

- **Connections**: Limited concurrent WebSocket connections per API key
- **Audio buffer**: Maximum ~15 minutes of buffered audio
- **Response length**: Configurable via `max_response_output_tokens`

---

## Error Handling

Common errors:

| Code | Meaning | Action |
|------|---------|--------|
| `invalid_api_key` | Bad API key | Check credentials |
| `rate_limit_exceeded` | Too many requests | Backoff and retry |
| `invalid_audio_format` | Wrong audio encoding | Check PCM16 format |
| `buffer_overflow` | Too much audio | Clear buffer, reduce input |
| `connection_closed` | WebSocket dropped | Reconnect with backoff |

---

## References

- [OpenAI Realtime API Guide](https://platform.openai.com/docs/guides/realtime)
- [OpenAI Realtime API Reference](https://platform.openai.com/docs/api-reference/realtime)
- [Realtime Console Demo](https://github.com/openai/openai-realtime-console)
