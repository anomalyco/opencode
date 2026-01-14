# @ai-context/compressor

A TypeScript context compression library for AI code assistants.

## Features

- **Zero Runtime Dependencies** - Pure TypeScript, no external dependencies
- **Configurable LLM Support** - Works with OpenAI, Anthropic, or custom providers
- **Extensible Storage** - In-memory or persistent storage interfaces
- **Full TypeScript Support** - Complete type definitions
- **Layered Compression** - Truncate → Prune → Summarize

## Installation

```bash
npm install @ai-context/compressor
```

## Quick Start

```typescript
import { ContextCompressor, MemoryStorage, OpenAIProvider } from '@ai-context/compressor'

// Create compressor with configuration
const compressor = new ContextCompressor(
  {
    maxTokens: 100000,
    outputReserve: 4000,
    truncate: { enabled: true, maxMessages: 50 },
    prune: { enabled: true, minimumSavings: 20000, protectRecent: 40000 },
    summarize: { enabled: true }
  },
  new MemoryStorage(),
  new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! })
)

// Compress messages
const { messages, result } = await compressor.compressMessages(messages)

console.log(`Strategy: ${result.strategy}`)
console.log(`Tokens saved: ${result.tokensSaved}`)
```

## License

MIT
