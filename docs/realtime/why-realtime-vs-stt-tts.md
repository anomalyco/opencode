# Why OpenAI Realtime vs STT + LLM + TTS

This document explains why we chose OpenAI Realtime API over a traditional speech pipeline.

## The Traditional Approach: STT + LLM + TTS

```
Audio In → Whisper (STT) → Text → GPT-4 (LLM) → Text → ElevenLabs (TTS) → Audio Out
           ~500-2000ms           ~500-2000ms          ~200-500ms

Total minimum latency: 1.2s - 4.5s
```

Three separate services, three API calls, three points of failure.

## OpenAI Realtime Approach

```
Audio In → [Single Audio-Native Model] → Audio Out

Total latency: ~300-500ms
```

One WebSocket connection, one model, native audio processing.

## Detailed Comparison

| Aspect | STT + LLM + TTS | OpenAI Realtime |
|--------|-----------------|-----------------|
| **End-to-end latency** | 1.2-4.5s | 300-500ms |
| **Audio understanding** | Text only (loses tone) | Native audio processing |
| **Audio generation** | TTS from text | Native speech synthesis |
| **Interruption** | Complex multi-service coordination | Native VAD-based |
| **Architecture** | 3 services, 3 APIs | 1 WebSocket |
| **VAD** | Implement yourself | Built-in server-side |
| **Turn-based?** | Yes (wait for STT complete) | Yes (wait for VAD) |
| **Cost per minute** | ~$0.15-0.20 | ~$0.30 |

## Key Advantages

### 1. Latency (3-10x Faster)

**STT + TTS Pipeline:**
```
User finishes speaking
    ↓ 500ms - STT processes audio
    ↓ 500ms - LLM generates response
    ↓ 300ms - TTS synthesizes speech
    ↓ Response starts playing

Total: ~1.3s best case, often 2-4s
```

**OpenAI Realtime:**
```
User finishes speaking (VAD detects silence)
    ↓ ~300ms - Model generates audio response
    ↓ Response starts playing

Total: ~300-500ms
```

In conversation, latency over 500ms feels unnatural. Realtime achieves conversational latency.

### 2. Native Audio Understanding

STT transcribes speech to text, **losing**:

| Lost Information | Example | Impact |
|------------------|---------|--------|
| Prosody | Rising intonation = question | Model doesn't know it's a question |
| Emotion | Frustrated tone | Model can't respond to frustration |
| Emphasis | "Read THIS file" vs "Read this FILE" | Loses user intent |
| Hesitation | "I want to... um... maybe delete it?" | Loses uncertainty signal |
| Speed | Rushed speech = urgency | Model doesn't sense urgency |

**Realtime processes audio natively** - it hears HOW you speak, not just WHAT you say.

### 3. Native Audio Generation

TTS converts text to speech, producing:
- Flat, robotic delivery
- Unnatural emphasis
- Awkward pacing at punctuation
- No emotional expression

**Realtime generates audio natively** - speech has natural prosody, appropriate emotion, and conversational rhythm.

### 4. Integrated Interruption Handling

**STT + TTS interruption is complex:**
```
User starts speaking during TTS playback
    ↓ Detect interruption (client-side VAD?)
    ↓ Stop TTS playback
    ↓ Clear audio output buffer
    ↓ Cancel pending TTS requests
    ↓ Signal LLM to stop generating
    ↓ Start STT on new audio
    ↓ Coordinate state across all services

Many failure modes, race conditions
```

**Realtime interruption is native:**
```
User starts speaking
    ↓ Server VAD detects speech_started
    ↓ Model stops generating
    ↓ Client stops playback (one event)
    ↓ New user turn begins

Single event, atomic state change
```

### 5. Simpler Architecture

**STT + TTS:**
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Whisper   │ ──→ │   GPT-4     │ ──→ │ ElevenLabs  │
│   (STT)     │     │   (LLM)     │     │   (TTS)     │
└─────────────┘     └─────────────┘     └─────────────┘
      ↑                   ↑                   ↑
   HTTP API           HTTP API            HTTP API

- 3 API connections to manage
- 3 billing accounts
- 3 rate limits
- 3 failure modes
- Complex state synchronization
```

**Realtime:**
```
┌─────────────────────────────────────────────────────┐
│              OpenAI Realtime API                    │
│   (Audio understanding + LLM + Audio generation)   │
└─────────────────────────────────────────────────────┘
                        ↑
                   1 WebSocket

- 1 connection
- 1 billing account
- 1 rate limit
- 1 failure mode
- Integrated state management
```

## What About Turn-Based Behavior?

Both approaches are turn-based:
- **STT + TTS**: Waits for STT to complete before LLM processes
- **Realtime**: Waits for VAD to detect silence before model responds

The difference is **latency**, not turn-taking behavior. Realtime is still turn-based, just faster.

## When to Use STT + TTS Instead

| Scenario | Recommendation |
|----------|----------------|
| Cost-sensitive | STT+TTS (~$0.15/min vs $0.30/min) |
| Need specific voice | TTS offers more voice options |
| Offline/local | Whisper + local LLM + Piper TTS |
| Non-English | Whisper has broader language support |
| Text-first with optional voice | STT+TTS bolted on to existing text flow |

## Cost Comparison

**STT + TTS (per minute):**
- Whisper: ~$0.006
- GPT-4o: ~$0.01-0.05 (depends on tokens)
- ElevenLabs: ~$0.10-0.30
- **Total: ~$0.12-0.35/min**

**OpenAI Realtime (per minute):**
- Audio input: $0.06
- Audio output: $0.24
- **Total: ~$0.30/min**

Roughly comparable, with Realtime slightly more expensive but significantly faster.

## Summary

| Factor | Winner | Margin |
|--------|--------|--------|
| Latency | Realtime | 3-10x faster |
| Audio understanding | Realtime | Native vs text-only |
| Audio quality | Realtime | Natural vs TTS |
| Interruption | Realtime | Native vs complex |
| Architecture | Realtime | 1 service vs 3 |
| Cost | STT+TTS | Slightly cheaper |
| Voice options | STT+TTS | More TTS voices |
| Offline capability | STT+TTS | Can run locally |

**Verdict**: For conversational voice agents, Realtime wins on the factors that matter most (latency, naturalness, simplicity). STT+TTS is better for cost-sensitive or offline scenarios.
