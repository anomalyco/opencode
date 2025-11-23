# Configuration System

OpenCode uses a hierarchical configuration system that allows customization at multiple levels, from global defaults to project-specific overrides.

## Configuration Hierarchy

```
┌─────────────────┐
│   Global        │ ← System-wide defaults
│   Defaults      │
└─────────────────┘
          │
          ▼
┌─────────────────┐
│   Project       │ ← Project-level config
│   Config        │   (.opencode/config.json)
└─────────────────┘
          │
          ▼
┌─────────────────┐
│   User          │ ← User-level config
│   Config        │   (~/.opencode/config.json)
└─────────────────┘
          │
          ▼
┌─────────────────┐
│   Environment   │ ← Environment variables
│   Variables     │   (OPENCODE_*)
└─────────────────┘
          │
          ▼
┌─────────────────┐
│   Command       │ ← CLI arguments
│   Line Args     │
└─────────────────┘
```

## Core Configuration Files

### Configuration Schema (`packages/opencode/src/config/config.ts`)

```typescript
export const Info = z.object({
  // AI Provider Configuration
  provider: z
    .record(
      z.string(),
      z.object({
        model: z.string().optional(),
        apiKey: z.string().optional(),
        baseURL: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
      }),
    )
    .optional(),

  // Default Model
  model: z.string().optional(),

  // Agent Configuration
  agent: z
    .record(
      z.string(),
      z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        mode: z.enum(["subagent", "primary", "all"]).optional(),
        builtIn: z.boolean().optional(),
        temperature: z.number().optional(),
        topP: z.number().optional(),
        color: z.string().optional(),
        permission: z
          .object({
            edit: z.enum(["allow", "ask", "deny"]).optional(),
            bash: z.record(z.string(), z.enum(["allow", "ask", "deny"])).optional(),
            webfetch: z.enum(["allow", "ask", "deny"]).optional(),
            doom_loop: z.enum(["allow", "ask", "deny"]).optional(),
            external_directory: z.enum(["allow", "ask", "deny"]).optional(),
          })
          .optional(),
        model: z
          .object({
            modelID: z.string(),
            providerID: z.string(),
          })
          .optional(),
        prompt: z.string().optional(),
        tools: z.record(z.string(), z.boolean()).optional(),
        options: z.record(z.string(), z.any()).optional(),
        disable: z.boolean().optional(),
      }),
    )
    .optional(),

  // Tool Configuration
  tools: z.record(z.string(), z.boolean()).optional(),

  // Permission Configuration
  permission: z
    .object({
      edit: z.enum(["allow", "ask", "deny"]).optional(),
      bash: z.record(z.string(), z.enum(["allow", "ask", "deny"])).optional(),
      webfetch: z.enum(["allow", "ask", "deny"]).optional(),
      doom_loop: z.enum(["allow", "ask", "deny"]).optional(),
      external_directory: z.enum(["allow", "ask", "deny"]).optional(),
    })
    .optional(),

  // Sharing Configuration
  share: z.enum(["auto", "disabled", "manual"]).optional(),

  // LSP Configuration
  lsp: z
    .record(
      z.string(),
      z.object({
        command: z.array(z.string()).optional(),
        args: z.array(z.string()).optional(),
        initializationOptions: z.record(z.string(), z.any()).optional(),
      }),
    )
    .optional(),

  // Format Configuration
  format: z
    .record(
      z.string(),
      z.object({
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
      }),
    )
    .optional(),

  // MCP Configuration
  mcp: z
    .record(
      z.string(),
      z.object({
        command: z.string(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
      }),
    )
    .optional(),

  // Plugin Configuration
  plugin: z.record(z.string(), z.any()).optional(),

  // Enterprise Configuration
  enterprise: z
    .object({
      url: z.string().optional(),
      token: z.string().optional(),
    })
    .optional(),
})
```

### Configuration Loading (`packages/opencode/src/config/config.ts`)

```typescript
export const get = fn(async () => {
  // 1. Load global defaults
  let config: Partial<Info> = {}

  // 2. Load project config
  const projectConfig = await loadProjectConfig()
  config = mergeDeep(config, projectConfig)

  // 3. Load user config
  const userConfig = await loadUserConfig()
  config = mergeDeep(config, userConfig)

  // 4. Apply environment variables
  const envConfig = loadEnvironmentConfig()
  config = mergeDeep(config, envConfig)

  // 5. Validate and return
  return Info.parse(config)
})
```

## Configuration Locations

### Project Configuration

```
project/
├── .opencode/
│   ├── config.json          # Project-specific config
│   ├── agents/             # Custom agent definitions
│   │   ├── security.json
│   │   └── specialist.json
│   ├── tools/              # Custom tool definitions
│   │   └── custom.json
│   └── rules/              # Custom rules
│       └── security.json
```

### User Configuration

```
~/.opencode/
├── config.json              # Global user config
├── providers/              # Provider credentials
│   ├── anthropic.json
│   ├── openai.json
│   └── google.json
└── themes/                 # Custom themes
    ├── custom.json
    └── dark-pro.json
```

## Provider Configuration

### AI Provider Setup

```json
{
  "provider": {
    "anthropic": {
      "model": "claude-3-5-sonnet",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "baseURL": "https://api.anthropic.com"
    },
    "openai": {
      "model": "gpt-4",
      "apiKey": "${OPENAI_API_KEY}",
      "baseURL": "https://api.openai.com/v1"
    },
    "google": {
      "model": "gemini-1.5-pro",
      "apiKey": "${GOOGLE_API_KEY}",
      "baseURL": "https://generativelanguage.googleapis.com"
    },
    "openrouter": {
      "model": "anthropic/claude-3.5-sonnet",
      "apiKey": "${OPENROUTER_API_KEY}",
      "baseURL": "https://openrouter.ai/api/v1"
    }
  }
}
```

### Environment Variables

```bash
# Provider API Keys
export ANTHROPIC_API_KEY="your-anthropic-key"
export OPENAI_API_KEY="your-openai-key"
export GOOGLE_API_KEY="your-google-key"

# Default Model
export OPENCODE_MODEL="anthropic/claude-3-5-sonnet"

# Sharing Behavior
export OPENCODE_SHARE="auto"

# Installation Directory
export OPENCODE_INSTALL_DIR="/usr/local/bin"

# Log Level
export OPENCODE_LOG_LEVEL="DEBUG"
```

## Agent Configuration

### Built-in Agent Customization

```json
{
  "agent": {
    "build": {
      "temperature": 0.7,
      "topP": 0.9,
      "color": "#2563eb",
      "tools": {
        "read": true,
        "write": true,
        "edit": true,
        "bash": true,
        "websearch": true,
        "webfetch": true
      }
    },
    "plan": {
      "temperature": 0.3,
      "color": "#f59e0b",
      "permission": {
        "edit": "deny",
        "bash": {
          "git*": "allow",
          "ls*": "allow",
          "cat*": "allow",
          "*": "ask"
        }
      }
    }
  }
}
```

### Custom Agent Definition

```json
{
  "agent": {
    "security": {
      "name": "security",
      "description": "Security-focused code review agent",
      "mode": "primary",
      "temperature": 0.1,
      "permission": {
        "edit": "ask",
        "bash": {
          "security-scan*": "allow",
          "audit*": "allow",
          "*": "deny"
        },
        "webfetch": "deny"
      },
      "tools": {
        "read": true,
        "grep": true,
        "websearch": false,
        "bash": false
      },
      "prompt": "You are a security expert focused on identifying vulnerabilities and security issues in code. Always explain security implications and suggest secure alternatives. Never execute potentially dangerous commands without explicit user confirmation."
    }
  }
}
```

## Tool Configuration

### Tool Access Control

```json
{
  "tools": {
    "read": true,
    "write": true,
    "edit": true,
    "bash": true,
    "websearch": true,
    "webfetch": true,
    "glob": true,
    "grep": true,
    "ls": true,
    "multiedit": true,
    "patch": true,
    "codesearch": false,
    "todowrite": false,
    "todoread": false
  }
}
```

### Custom Tool Registration

```json
{
  "tools": {
    "security-scan": {
      "enabled": true,
      "config": {
        "severity": "high",
        "exclude": ["*.test.js", "node_modules/**"]
      }
    }
  }
}
```

## Permission System

### Permission Levels

```json
{
  "permission": {
    "edit": "allow", // "allow" | "ask" | "deny"
    "bash": {
      "*": "allow", // Default for all commands
      "rm*": "ask", // Ask for destructive commands
      "sudo*": "deny", // Block privileged commands
      "git*": "allow", // Allow git commands
      "npm*": "ask" // Ask for package management
    },
    "webfetch": "allow", // Web access permissions
    "doom_loop": "ask", // Prevent infinite loops
    "external_directory": "ask" // Access outside project
  }
}
```

### Agent-Specific Permissions

```json
{
  "agent": {
    "plan": {
      "permission": {
        "edit": "deny",
        "bash": {
          "cat*": "allow",
          "ls*": "allow",
          "grep*": "allow",
          "git diff*": "allow",
          "git log*": "allow",
          "git status*": "allow",
          "*": "ask"
        },
        "webfetch": "allow"
      }
    }
  }
}
```

## LSP Configuration

### Language Server Setup

```json
{
  "lsp": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "initializationOptions": {
        "preferences": {
          "includeInlayParameterNameHints": "all",
          "includeInlayParameterTypeHints": "whenLiteral"
        }
      }
    },
    "python": {
      "command": "pylsp",
      "args": ["--stdio"],
      "initializationOptions": {
        "pylsp": {
          "plugins": {
            "pycodestyle": { "enabled": true },
            "mccabe": { "enabled": true }
          }
        }
      }
    },
    "go": {
      "command": "gopls",
      "args": ["serve"],
      "initializationOptions": {
        "usePlaceholders": true
      }
    }
  }
}
```

## Format Configuration

### Code Formatter Setup

```json
{
  "format": {
    "typescript": {
      "command": "prettier",
      "args": ["--write", "--stdin-filepath", "$FILE"]
    },
    "python": {
      "command": "black",
      "args": ["--stdin-filename", "$FILE", "-"]
    },
    "go": {
      "command": "gofmt",
      "args": ["-w", "$FILE"]
    },
    "json": {
      "command": "jq",
      "args": [".", "$FILE"]
    }
  }
}
```

## MCP Configuration

### MCP Server Setup

```json
{
  "mcp": {
    "filesystem": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/path/to/allowed/directory"],
      "env": {
        "ALLOWED_DIRECTORIES": "/path/to/allowed/directory"
      }
    },
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "brave-search": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "${BRAVE_API_KEY}"
      }
    }
  }
}
```

## Plugin Configuration

### Plugin Setup

```json
{
  "plugin": {
    "github": {
      "enabled": true,
      "token": "${GITHUB_TOKEN}",
      "defaultBranch": "main"
    },
    "slack": {
      "enabled": false,
      "webhook": "${SLACK_WEBHOOK}",
      "channel": "#opencode"
    },
    "custom-integration": {
      "enabled": true,
      "apiEndpoint": "https://api.example.com",
      "apiKey": "${CUSTOM_API_KEY}"
    }
  }
}
```

## Enterprise Configuration

### Enterprise Setup

```json
{
  "enterprise": {
    "url": "https://enterprise.opencode.ai",
    "token": "${ENTERPRISE_TOKEN}",
    "workspace": "my-company"
  }
}
```

## Configuration Management

### CLI Commands

```bash
# View current configuration
opencode config

# Set configuration values
opencode config set model anthropic/claude-3-5-sonnet
opencode config set share auto
opencode config set agent.build.temperature 0.8

# Get specific configuration
opencode config get model
opencode config get agent.build.temperature

# Reset configuration
opencode config reset
opencode config reset agent.build.temperature

# Edit configuration file
opencode config edit
```

### Configuration Validation

```typescript
// packages/opencode/src/config/config.ts
export const validate = (config: unknown): Info => {
  try {
    return Info.parse(config)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const formatted = error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n")
      throw new Error(`Configuration validation failed:\n${formatted}`)
    }
    throw error
  }
}
```

### Configuration Migration

```typescript
// Handle configuration version upgrades
export const migrate = async (config: any): Promise<Info> => {
  let migrated = { ...config }

  // Migrate from v0.1 to v0.2
  if (config.version === "0.1") {
    // Update agent structure
    if (config.agents) {
      migrated.agent = config.agents
      delete migrated.agents
    }

    // Update permission structure
    if (config.permissions) {
      migrated.permission = config.permissions
      delete migrated.permissions
    }

    migrated.version = "0.2"
  }

  return Info.parse(migrated)
}
```

## Environment-Specific Configuration

### Development Configuration

```json
{
  "log_level": "DEBUG",
  "share": "disabled",
  "provider": {
    "anthropic": {
      "model": "claude-3-5-sonnet",
      "baseURL": "http://localhost:8080"
    }
  }
}
```

### Production Configuration

```json
{
  "log_level": "INFO",
  "share": "auto",
  "permission": {
    "bash": {
      "*": "ask"
    }
  },
  "enterprise": {
    "url": "https://enterprise.opencode.ai"
  }
}
```

## Configuration Best Practices

### Security

1. **Use Environment Variables** for sensitive data
2. **Restrict File Permissions** on config files
3. **Validate Configuration** on load
4. **Use Least Privilege** for permissions

### Performance

1. **Lazy Load** configuration sections
2. **Cache Validation Results**
3. **Minimize Configuration Size**
4. **Use Default Values** where possible

### Maintainability

1. **Document All Options**
2. **Use Semantic Versioning**
3. **Provide Migration Paths**
4. **Validate Schema Changes**

The configuration system provides flexible, secure, and maintainable way to customize OpenCode behavior across different environments and use cases.
