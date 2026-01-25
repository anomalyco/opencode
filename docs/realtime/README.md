# OpenAI Realtime API Integration

This documentation covers the plan for adding true conversational voice support to opencode using OpenAI's Realtime API.

## Overview

Unlike traditional TTS/STT workflows, the Realtime API provides:
- **Native bidirectional audio streaming** via WebSocket
- **Server-side Voice Activity Detection (VAD)** for natural turn-taking
- **Interruption support** - users can interrupt the assistant mid-response
- **Integrated tool calling** during voice conversations

## Goals

1. **True Realtime Voice**: Native audio streaming, not TTS/STT wrapper
2. **Natural Conversations**: Server-side VAD for pause detection and interruption handling
3. **Full Compatibility**: Integrate seamlessly with existing opencode architecture
4. **Extensibility**: Design for future realtime providers (e.g., Gemini Live)

## Documentation Structure

| Document | Description |
|----------|-------------|
| [Roadmap](./roadmap.md) | High-level phases from MVP to dual-agent architecture |
| [Architecture](./architecture.md) | System design, message flow, WebSocket transport |
| [SDK Choice](./sdk-choice.md) | Research on SDK options and decision rationale |
| [Tool Integration](./tool-integration.md) | How existing tools work in realtime mode |
| [Types](./types.md) | New type definitions (AudioPart, RealtimeEventPart, etc.) |
| [OpenAI API Reference](./openai-api.md) | OpenAI Realtime API events and configuration |
| [Implementation Tasks](./implementation-tasks.md) | TDD-style incremental implementation plan |
| [Decisions](./decisions.md) | Architecture decisions and trade-offs |

## Quick Links

- **OpenAI Realtime API**: https://platform.openai.com/docs/guides/realtime
- **OpenAI Realtime API Reference**: https://platform.openai.com/docs/api-reference/realtime

## Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| WebSocket Infrastructure | ✅ Available | `hono/bun` websocket imported but unused |
| Provider System | ✅ Extensible | Custom loaders, model metadata, modality support |
| Audio Modality Detection | ✅ Partial | `mimeToModality()` handles audio MIME types |
| Streaming Infrastructure | ✅ Working | SSE for events, HTTP streaming for responses |
| Message Parts System | ⚠️ Needs Extension | No `AudioPart` or `VADEventPart` types |
| Session System | ✅ Compatible | Can accommodate audio I/O |

## What Needs to Be Built

1. **WebSocket Transport Layer** - Bidirectional audio streaming
2. **Realtime Provider Abstraction** - OpenAI Realtime protocol mapping
3. **Audio Message Parts** - New part types for audio data
4. **Client Audio Handling** - Capture, playback, WebSocket client
5. **VAD Integration** - Handle interruptions and turn-taking
6. **TUI/Desktop Audio UI** - Indicators, controls, settings
