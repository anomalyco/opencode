# @kilocode/kilo-gateway

Unified Kilo Gateway package for OpenCode providing authentication, AI provider integration, and API access.

## Features

- **Authentication**: Device authorization flow for Kilo Gateway
- **AI Provider**: OpenRouter-based provider with Kilo Gateway integration
- **API Integration**: Profile, balance, and model management
- **TUI Helpers**: Utilities for terminal UI components

## Installation

```bash
bun add @kilocode/kilo-gateway
```

## Usage

### Plugin Registration

```typescript
import { KiloAuthPlugin } from "@kilocode/kilo-gateway"

// Register with OpenCode
const plugins = [KiloAuthPlugin]
```

### Provider Usage

```typescript
import { createKilo } from "@kilocode/kilo-gateway"

const provider = createKilo({
  kilocodeToken: process.env.KILOCODE_API_KEY,
  kilocodeOrganizationId: "org-123",
})

const model = provider.languageModel("anthropic/claude-sonnet-4")
```

### API Access

```typescript
import { fetchProfile, fetchBalance } from "@kilocode/kilo-gateway"

const profile = await fetchProfile(token)
const balance = await fetchBalance(token)
```

## License

MIT
