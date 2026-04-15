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

## Configuration Security Defaults

SecureCode automatically applies absolute, un-bypassable blocks on all `.opencode` configuration directories. The target working directory's `.opencode` folder, as well as `~/.opencode`, are intrinsically hard-blocked from both read and write access (`denyRead`, `denyWrite`) across every active sandbox.

This is fundamentally necessary to guarantee that sandboxed AI bash processes and hijacked MCPs cannot edit or escalate their own internal configurations to orchestrate a silent perimeter breach.

SecureCode integrates with the pre-existing `.opencode` directory paths, so you do not need to reconfigure your standard environments. However, it relies exclusively on a completely separate file named `securecode.json` (or `securecode.jsonc`) to apply sandbox barriers. This ensures your base upstream permissions (like `"permission": { "bash": "allow" }` configured inside `opencode.json`) remain strictly decoupled from the sandbox execution environment overlay.

Create these configurations at `~/.opencode/securecode.json` (for global rules) and/or `.opencode/securecode.json` inside individual project workspaces. Below are several configuration exemplars ranging from low-friction basics to zero-trust deployments.

#### 1. The Secure Automated Default (Recommended)
This profile provides the best balance of friction-less AI automation and strict network/environment isolation. It relies on the interplay of two configurations to run commands automatically confined in the sandbox, while safely allowing the AI to dynamically request your permission to bypass network airgaps.

**`~/.opencode/opencode.json` (Automation Layer)**:
```jsonc
{
  "permission": {
    "*": "allow",
    "bash": "allow",
    "external_directory": "ask"
  }
}
```

**`~/.opencode/securecode.json` (Sandbox Layer)**:
```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "bash_sandbox": {
    "enabled": "prompt", 
    "provider": "srt"
  },
  "mcp_sandbox": {
    "enabled": true,
    "provider": "srt"
  }
}
```

*How it works*: With `"prompt"` mode and `bash: "allow"` combined, the AI executes all queries silently and instantaneously inside the secure `srt` container. However, if the sandbox structurally blocks a command (e.g. proxy denial), the AI can explicitly deploy `request_native_elevation`. This seamlessly transforms the UI into an interactive `[Run Sandbox] / [Run Native]` prompt, allowing you to manually verify its bypass request, temporarily or permanently for that specific command.

### 2. Strict Containment (Zero Fallbacks)
If you require an infrastructure that strictly cannot be bypassed under any circumstances from the UI, enable strict isolation. The AI operates automatically, but its boundaries are absolute.

**`~/.opencode/securecode.json`**:
```jsonc
{
  "bash_sandbox": {
    "enabled": true,
    "provider": "srt"
  }
}
```

*How it works*: The sandbox perimeter relies on `true` instead of `"prompt"`. The AI continues to run automatically but is physically blocked from utilizing native escalation requests. If an isolated execution hits a firewall, it structurally fails permanently in that environment.

### 3. Paranoid Mode (Internal Defenses)
Designed for ultra-sensitive zero-trust architecture, this restricts the AI perfectly to explicit host data, aggressively cleaning OS environment leakage and blocking inbound/outbound external data extractions.

**`~/.opencode/securecode.json`**:
```jsonc
{
  "bash_sandbox": {
    "enabled": true,
    "provider": "srt",
    "domains": [], // Empty array forces absolute network airgap
    "env_whitelist": [
      // Only pass necessary variables. Drops sensitive payload leaks!
      "PATH", "HOME", "TERM", "LANG", "USER", "SHELL", "TMPDIR"
    ],
    "deny_workspace_patterns": [
      "**/*.secret", 
      "**/*.key", 
      "**/.env*", 
      "secrets_dir/*"
    ]
  }
}
```

### 4. Completely Interactive (Zero Automation)
If you do not want the AI running commands in the background silently—sandboxed or not—you can revoke the automation layer while maintaining sandbox boundaries.

**`~/.opencode/opencode.json`**:
```jsonc
{
  "permission": {
    "bash": "ask" // Overrides automation. Forces generic [Accept] prompts for EVERY execution.
  }
}
```
**`~/.opencode/securecode.json`**:
```jsonc
{
  "bash_sandbox": {
    "enabled": "prompt",
    "provider": "srt"
  }
}
```

### 5. Complete Relax (Development Mode)
Disables execution boundaries totally. Commands run natively on the original file directories and host OS stack instantly. Use this if you are actively debugging your own native codebase deployments where root-level dependencies or Docker containers are critical and `srt` emulation is failing.

**`~/.opencode/securecode.json`**:
```jsonc
{
  "bash_sandbox": {
    "enabled": false
  },
  "mcp_sandbox": {
    "enabled": false
  }
}
```

*When you boot `securecode`, the terminal UI console will inherently inform you exactly which of these restrictive boundaries successfully engaged across your bash and MCP toolsets.*
