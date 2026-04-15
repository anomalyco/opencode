# SecureCode

**SecureCode** is a fork of [OpenCode](https://github.com/anomalyco/opencode) (currently tracking base `v1.4.6`) focusing on execution-level sandboxing. I built this as a personal experiment to learn about sandboxing AI coding agents.

This project modifies the backend execution tools to restrict state and access by running them in a confined environment powered by Anthropic's Simple Run Time (SRT) project. It provides granular sandboxing layers that can securely isolate both raw `bash` executions and local Model Context Protocol (MCP) servers. 

*Note: SRT-based sandboxing requires namespace and socket capabilities natively supported only on Linux and macOS. Windows is explicitly not supported.*

For the project's original features and usage documentation, refer to the [OpenCode Repository](https://github.com/anomalyco/opencode). The rest of this document outlines the sandbox-specific installation and configuration details.

---

## Installation

SecureCode is distributed as a standalone binary via the `kyuz0/securecode` package.

```bash
# Install globally via NPM
npm install -g @kyuz0/securecode

# Or via Bun
bun install -g @kyuz0/securecode
```

Once installed, simply run `securecode` in your terminal to start the TUI.

---

## Configuration

SecureCode integrates with the pre-existing `.opencode` directory paths, so you do not need to reconfigure your standard environments. However, it relies exclusively on a file named `securecode.json` (or `securecode.jsonc`) to apply sandbox barriers.

Create these configurations at `~/.opencode/securecode.json` (for global rules) and/or `.opencode/securecode.json` inside individual project workspaces. Below are several configuration exemplars ranging from low-friction basics to zero-trust deployments.

### 1. The Baseline Quickstart
A zero-friction setup that simply engages the SRT isolation layers for standard bash tasks and local MCP servers without stripping networking.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "bash_sandbox": {
    "enabled": true,
    "provider": "srt"
  },
  "mcp_sandbox": {
    "enabled": true,
    "provider": "srt"
  }
}
```

### 2. The Egress Airgap (No Network Access)
Restricts inbound/outbound domains completely to prevent the agent from extracting code, curling unauthorized remote payloads, or leaking data.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "bash_sandbox": {
    "enabled": true,
    "provider": "srt",
    "domains": [] // Empty array forces absolute airgap
  }
}
```

### 3. Deep Workspace Secrets Protection 
Designed for sensitive repositories, this specifies fine-grained masks to strictly prevent the agent executing bash tools from accessing or tampering with configuration elements.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "bash_sandbox": {
    "enabled": true,
    "provider": "srt",
    "deny_workspace_patterns": [
      "**/*.secret", 
      "**/*.key", 
      "**/.env*", 
      "secrets_dir/*"
    ]
  }
}
```

### 4. Environment Sanitization (Zero-Trust)
Operating systems natively bleed critical host environment variables (like `AWS_ACCESS_KEY_ID` or `DATABASE_URL`) into bash subprocesses. This sanitizes the shell explicitly.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "bash_sandbox": {
    "enabled": true,
    "provider": "srt",
    "env_whitelist": [
      // Only pass absolute essentials. Drops everything else!
      "PATH", "HOME", "TERM", "LANG", "USER", "SHELL", "TMPDIR"
    ]
  }
}
```

### 5. Executable Hardening (Binary Denylist)
Guards against the agent chaining together host-installed tools to pivot or perform internal network mapping.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "bash_sandbox": {
    "enabled": true,
    "provider": "srt",
    "deny_binaries": [
      "nmap",
      "nc",
      "netcat",
      "wget",
      "curl"
    ]
  }
}
```

### 6. Tool-by-Tool MCP Granularity 
Sandboxing applies to AI tool executions natively handled via MCP. Here we globally restrict MCP networking but explicitly carve out an exception for a single database tool.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  // Base rule applies to all unconfigured MCP
  "mcp_sandbox": {
    "enabled": true,
    "provider": "srt",
    "domains": [] // Default MCP servers are airgapped
  },
  "mcp": {
    "local-db-tool": {
      "type": "local",
      "command": ["npx", "-y", "sqlite-mcp-server"],
      // Explicit sandbox override for THIS specific tool
      "sandbox": {
        "domains": ["api.supabase.com"],
        "env_whitelist": ["DB_CONNECTION_STRING"]
      }
    }
  }
}
```

When you boot `securecode`, the console will inherently inform you that these restrictive boundaries have engaged.


