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

## Configuration Protection Policy

SecureCode sandbox blocks access to all `.opencode` configuration directories. The active workspace `.opencode` folder, `~/.config/opencode`, and `~/.opencode` are marked `denyRead` and `denyWrite` across all sandboxes.

This prevents sandboxed bash processes and MCPs from modifying internal configurations and escalating privileges.

Additionally, the default SRT sandbox enforces strict containment baselines out-of-the-box:
- **Filesystem**: Read and write capabilities are restricted to the active working directory and `/tmp` (with read-only exceptions limited to development toolchains like `.nvm` or `.cargo`). The user's home directory is explicitly masked via `denyRead`.
- **Networking**: All network egress is disabled by default. Sandboxed processes operate within a network airgap unless specific domains are whitelisted.

## Setting Up Configurations

SecureCode integrates with the existing XDG and `.opencode` directory paths. However, it requires an additional configuration file called `securecode.json` to host the specific parameters for the sandbox.

Create these configurations at `~/.config/opencode/securecode.json` (global rules) and/or `.opencode/securecode.json` (workspace rules). Below are configuration profiles.

#### 1. Automation Default (Recommended)
This profile provides AI automation with network/environment isolation. It runs commands automatically in the sandbox, allowing SecureCode to request permission to bypass the sandbox and run commands natively if necessary.

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

*Mechanism*: With `"prompt"` mode and `bash: "allow"`, SecureCode executes queries inside the `srt` container. If the sandbox blocks a command, SecureCode triggers `request_native_elevation`, invoking an interactive `[Run Sandbox] / [Run Native]` prompt.

### 2. Strict Containment
This profile forces all bash commands to execute inside the sandbox permanently. There is no way to bypass the sandbox or request native execution as in the previous option.

**`~/.opencode/securecode.json`**:
```jsonc
{
  "bash_sandbox": {
    "enabled": true,
    "provider": "srt"
  }
}
```

*Mechanism*: Using `enabled: true` instead of `"prompt"` removes the native execution prompt overlay. All commands execute within the sandbox, and any command hitting a perimeter restriction will fail.

### 3. Granular Policy
This profile demonstrates how to control specific environment variables, whitelist network domains, and deny access to sensitive workspace files like `.env`.

**`~/.opencode/securecode.json`**:
```jsonc
{
  "bash_sandbox": {
    "enabled": true,
    "provider": "srt",
    "domains": [
      "api.github.com",
      "registry.npmjs.org"
    ],
    "env_whitelist": [
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

### 4. Disabled
Disables execution boundaries. Commands run natively on the host OS. Use this when debugging local deployments where `srt` emulation fails.

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
