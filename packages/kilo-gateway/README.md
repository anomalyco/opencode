# @opencode-ai/kilo-gateway

Kilo Gateway package for OpenCode providing authentication, AI provider integration, and API access.

## Features

- **Authentication**: Device authorization flow for Kilo Gateway
- **AI Provider**: OpenRouter-based provider with Kilo Gateway integration
- **API Integration**: Profile, balance, and model management
- **TUI Helpers**: Utilities for terminal UI components

## Installation

```bash
bun add @opencode-ai/kilo-gateway
```

## Usage

### Plugin Registration

```typescript
import { KiloAuthPlugin } from "@opencode-ai/kilo-gateway"

// Register with OpenCode
const plugins = [KiloAuthPlugin]
```

### Provider Usage

```typescript
import { createKilo } from "@opencode-ai/kilo-gateway"

const provider = createKilo({
  kilocodeToken: process.env.KILO_API_KEY,
  kilocodeOrganizationId: "org-123",
})

const model = provider.languageModel("anthropic/claude-sonnet-4")
```

### API Access

```typescript
import { fetchProfile, fetchBalance } from "@opencode-ai/kilo-gateway"

const profile = await fetchProfile(token)
const balance = await fetchBalance(token)
```

## License

MIT
