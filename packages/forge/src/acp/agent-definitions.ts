import type { ACPAgentDefinition } from "./agents.js"

/**
 * All available ACP agent definitions.
 * These are the agents that can be used with Forge.
 */
export const AGENT_DEFINITIONS: ACPAgentDefinition[] = [
  {
    name: "Auggie",
    description: "Augment Code's AI coding assistant",
    command: "auggie",
    acpStartupArgs: ["--acp"],
    args: ["--acp"],
    installGuide: "https://docs.augmentcode.com/cli/acp",
    color: "#888888",
    installCommands: {
      unix: [
        {
          method: "npm",
          command: "npm install -g @augmentcode/auggie@latest",
          description: "Install via npm (requires Node.js 22+)",
        },
      ],
      windows: [
        {
          method: "npm",
          command: "npm install -g @augmentcode/auggie@latest",
          description: "Install via npm (requires Node.js 22+)",
        },
      ],
    },
    uninstallCommands: {
      unix: [
        {
          method: "npm",
          command: "npm uninstall -g @augmentcode/auggie",
          description: "Uninstall via npm (global)",
        },
      ],
      windows: [
        {
          method: "npm",
          command: "npm uninstall -g @augmentcode/auggie",
          description: "Uninstall via npm (global)",
        },
      ],
    },
  },
  {
    name: "Claude Code ACP",
    description: "ACP adapter for Claude Code Zed Industries",
    command: "claude-code-acp",
    acpStartupArgs: [],
    args: [],
    installGuide: "https://github.com/zed-industries/claude-code-acp",
    color: "#da7756",
    installCommands: {
      unix: [
        {
          method: "npm",
          command: "npm install -g @zed-industries/claude-code-acp",
          description: "Install via npm (global)",
        },
      ],
      windows: [
        {
          method: "npm",
          command: "npm install -g @zed-industries/claude-code-acp",
          description: "Install via npm (global)",
        },
      ],
    },
    uninstallCommands: {
      unix: [
        {
          method: "npm",
          command: "npm uninstall -g @zed-industries/claude-code-acp",
          description: "Uninstall via npm (global)",
        },
      ],
      windows: [
        {
          method: "npm",
          command: "npm uninstall -g @zed-industries/claude-code-acp",
          description: "Uninstall via npm (global)",
        },
      ],
    },
  },
  {
    name: "Code Assistant",
    description: "Rust-based coding agent with streaming and tool execution support",
    command: "code-assistant",
    acpStartupArgs: ["acp"],
    args: ["acp"],
    installGuide: "https://github.com/stippi/code-assistant",
    color: "#888888",
    installCommands: {
      unix: [
        {
          method: "cargo",
          command: "git clone https://github.com/stippi/code-assistant && cd code-assistant && cargo build --release",
          description: "Build from source (macOS requires Metal toolchain: xcodebuild -downloadComponent MetalToolchain)",
        },
      ],
      windows: [
        {
          method: "cargo",
          command: "git clone https://github.com/stippi/code-assistant && cd code-assistant && cargo build --release",
          description: "Build from source (Windows support unclear - check documentation)",
        },
      ],
    },
    uninstallCommands: {
      unix: [
        {
          method: "cargo",
          command: 'echo "Remove the code-assistant build artifacts manually"',
          description: "Manual cleanup required",
        },
      ],
      windows: [
        {
          method: "cargo",
          command: 'echo "Remove the code-assistant build artifacts manually"',
          description: "Manual cleanup required",
        },
      ],
    },
  },
  {
    name: "Codex ACP",
    description: "ACP adapter for Codex from Zed Industries",
    command: "codex-acp",
    acpStartupArgs: [],
    args: [],
    installGuide: "https://github.com/zed-industries/codex-acp",
    color: "#6c908e",
    installCommands: {
      unix: [
        {
          method: "npm",
          command: "npm install -g @zed-industries/codex-acp",
          description: "Install via npm (global)",
        },
      ],
      windows: [
        {
          method: "npm",
          command: "npm install -g @zed-industries/codex-acp",
          description: "Install via npm (global)",
        },
      ],
    },
    uninstallCommands: {
      unix: [
        {
          method: "npm",
          command: "npm uninstall -g @zed-industries/codex-acp",
          description: "Uninstall via npm (global)",
        },
      ],
      windows: [
        {
          method: "npm",
          command: "npm uninstall -g @zed-industries/codex-acp",
          description: "Uninstall via npm (global)",
        },
      ],
    },
  },
  {
    name: "Fast Agent",
    description: "Define, Prompt and Test MCP enabled Agents and Workflows",
    command: "fast-agent",
    acpStartupArgs: ["acp"],
    args: ["acp"],
    installGuide: "https://github.com/evalstate/fast-agent",
    color: "#888888",
    installCommands: {
      unix: [
        {
          method: "uv",
          command: "uv tool install --python 3.13 fast-agent-mcp",
          description: "Install via uv tool (global)",
        },
      ],
      windows: [
        {
          method: "uv",
          command: "uv tool install --python 3.13 fast-agent-mcp",
          description: "Install via uv tool (global)",
        },
      ],
    },
    uninstallCommands: {
      unix: [
        {
          method: "uv",
          command: "uv tool uninstall fast-agent-mcp",
          description: "Uninstall via uv tool",
        },
      ],
      windows: [
        {
          method: "uv",
          command: "uv tool uninstall fast-agent-mcp",
          description: "Uninstall via uv tool",
        },
      ],
    },
  },
  {
    name: "Gemini CLI",
    description: "Brings the power of Gemini directly into your terminal",
    command: "gemini",
    acpStartupArgs: ["--experimental-acp"],
    args: ["--experimental-acp"],
    installGuide: "https://github.com/google-gemini/gemini-cli",
    color: "#cda9fc",
    installCommands: {
      unix: [
        {
          method: "brew",
          command: "brew install gemini-cli",
          description: "Install via Homebrew (macOS/Linux)",
        },
        {
          method: "npm",
          command: "npm install -g @google/gemini-cli",
          description: "Install via npm (global)",
        },
      ],
      windows: [
        {
          method: "npm",
          command: "npm install -g @google/gemini-cli",
          description: "Install via npm (global)",
        },
      ],
    },
    uninstallCommands: {
      unix: [
        {
          method: "npm",
          command: "npm uninstall -g @google/gemini-cli",
          description: "Uninstall via npm (global)",
        },
      ],
      windows: [
        {
          method: "npm",
          command: "npm uninstall -g @google/gemini-cli",
          description: "Uninstall via npm (global)",
        },
      ],
    },
  },
  {
    name: "Goose",
    description: "Block's autonomous coding agent",
    command: "goose",
    acpStartupArgs: ["acp"],
    args: ["acp"],
    installGuide: "https://block.github.io/goose/docs/getting-started/installation",
    color: "#ffffff",
    installCommands: {
      unix: [
        {
          method: "brew",
          command: "brew install block-goose-cli",
          description: "Install CLI via Homebrew",
        },
        {
          method: "curl",
          command: "curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash",
          description: "Install via official script",
        },
      ],
      windows: [
        {
          method: "powershell",
          command: "Invoke-WebRequest -Uri https://github.com/block/goose/releases/download/stable/download_cli.ps1 -OutFile download_cli.ps1; .\\download_cli.ps1",
          description: "Install via PowerShell script",
        },
      ],
    },
    uninstallCommands: {
      unix: [
        {
          method: "brew",
          command: "brew uninstall block-goose-cli",
          description: "Uninstall via Homebrew",
        },
      ],
      windows: [
        {
          method: "powershell",
          command: "Write-Output 'Please uninstall Goose CLI manually (no scripted uninstall available)'",
          description: "Manual uninstall required",
        },
      ],
    },
  },
  {
    name: "Kimi CLI",
    description: "Moonshot AI's Kimi code assistant",
    command: "kimi",
    acpStartupArgs: ["--acp"],
    args: ["--acp"],
    installGuide: "https://github.com/MoonshotAI/kimi-cli",
    color: "#5baefe",
    installCommands: {
      unix: [
        {
          method: "uv",
          command: "uv tool install --python 3.13 kimi-cli",
          description: "Install via uv (requires Python 3.13)",
        },
      ],
      windows: [
        {
          method: "uv",
          command: "uv tool install --python 3.13 kimi-cli",
          description: "Install via uv (requires Python 3.13)",
        },
      ],
    },
    uninstallCommands: {
      unix: [
        {
          method: "uv",
          command: "uv tool uninstall kimi-cli",
          description: "Uninstall via uv tool",
        },
      ],
      windows: [
        {
          method: "uv",
          command: "uv tool uninstall kimi-cli",
          description: "Uninstall via uv tool",
        },
      ],
    },
  },
  {
    name: "LLMling-Agent",
    description: "Python-based agent framework with file and terminal access",
    command: "llmling-agent",
    acpStartupArgs: ["serve-acp", "config.yml", "--file-access", "--terminal-access"],
    args: ["serve-acp", "config.yml", "--file-access", "--terminal-access"],
    installGuide: "https://phil65.github.io/llmling-agent/cli/",
    color: "#888888",
    installCommands: {
      unix: [
        {
          method: "uv",
          command: "uv tool install --python 3.13 'llmling-agent[default]@latest'",
          description: "Install via uv (requires Python 3.13)",
        },
        {
          method: "pip",
          command: "pip install 'llmling-agent[default]'",
          description: "Install via pip",
        },
      ],
      windows: [
        {
          method: "uv",
          command: "uv tool install --python 3.13 'llmling-agent[default]@latest'",
          description: "Install via uv (requires Python 3.13)",
        },
        {
          method: "pip",
          command: "pip install 'llmling-agent[default]'",
          description: "Install via pip",
        },
      ],
    },
    uninstallCommands: {
      unix: [
        {
          method: "uv",
          command: "uv tool uninstall llmling-agent",
          description: "Uninstall via uv tool",
        },
        {
          method: "pip",
          command: "pip uninstall llmling-agent",
          description: "Uninstall via pip",
        },
      ],
      windows: [
        {
          method: "uv",
          command: "uv tool uninstall llmling-agent",
          description: "Uninstall via uv tool",
        },
        {
          method: "pip",
          command: "pip uninstall llmling-agent",
          description: "Uninstall via pip",
        },
      ],
    },
  },
  {
    name: "Mistral Vibe",
    description: "CLI coding assistant powered by Mistral's models",
    command: "vibe",
    acpStartupArgs: ["--acp"],
    args: ["--acp"],
    installGuide: "https://github.com/mistralai/mistral-vibe",
    color: "#FA520F",
    installCommands: {
      unix: [
        {
          method: "curl",
          command: "curl -LsSf https://mistral.ai/vibe/install.sh | bash",
          description: "Install via official installer script",
        },
        {
          method: "uv",
          command: "uv tool install mistral-vibe",
          description: "Install via uv",
        },
        {
          method: "pip",
          command: "pip install mistral-vibe",
          description: "Install via pip",
        },
      ],
      windows: [
        {
          method: "uv",
          command: 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex" && uv tool install mistral-vibe',
          description: "Install uv first, then install mistral-vibe",
        },
      ],
    },
    uninstallCommands: {
      unix: [
        {
          method: "uv",
          command: "uv tool uninstall mistral-vibe",
          description: "Uninstall via uv tool",
        },
        {
          method: "pip",
          command: "pip uninstall mistral-vibe",
          description: "Uninstall via pip",
        },
      ],
      windows: [
        {
          method: "uv",
          command: "uv tool uninstall mistral-vibe",
          description: "Uninstall via uv tool",
        },
      ],
    },
  },
  {
    name: "OpenCode",
    description: "SST's open-source code agent",
    command: "opencode",
    acpStartupArgs: ["acp"],
    args: ["acp"],
    installGuide: "https://github.com/sst/opencode",
    color: "#ffba88",
    installCommands: {
      unix: [
        {
          method: "brew",
          command: "brew install opencode",
          description: "Install via Homebrew",
        },
        {
          method: "curl",
          command: "curl -fsSL https://opencode.ai/install | bash",
          description: "Install via official installer",
        },
        {
          method: "npm",
          command: "npm install -g opencode-ai@latest",
          description: "Install via npm (global)",
        },
      ],
      windows: [
        {
          method: "scoop",
          command: "scoop bucket add extras && scoop install extras/opencode",
          description: "Install via Scoop",
        },
        {
          method: "choco",
          command: "choco install opencode",
          description: "Install via Chocolatey",
        },
        {
          method: "npm",
          command: "npm install -g opencode-ai@latest",
          description: "Install via npm (global)",
        },
      ],
    },
    uninstallCommands: {
      unix: [
        {
          method: "brew",
          command: "brew uninstall opencode",
          description: "Uninstall via Homebrew",
        },
        {
          method: "npm",
          command: "npm uninstall -g opencode-ai",
          description: "Uninstall via npm (global)",
        },
      ],
      windows: [
        {
          method: "scoop",
          command: "scoop uninstall opencode",
          description: "Uninstall via Scoop",
        },
        {
          method: "choco",
          command: "choco uninstall opencode",
          description: "Uninstall via Chocolatey",
        },
        {
          method: "npm",
          command: "npm uninstall -g opencode-ai",
          description: "Uninstall via npm (global)",
        },
      ],
    },
  },
  {
    name: "OpenHands",
    description: "Lightweight, modern CLI to interact with the OpenHands agent",
    command: "openhands",
    acpStartupArgs: ["acp"],
    args: ["acp"],
    installGuide: "https://docs.openhands.dev/openhands/usage/run-openhands/acp",
    color: "#feff8c",
    installCommands: {
      unix: [
        {
          method: "uv",
          command: "uv tool install openhands",
          description: "Install OpenHands CLI via uv (requires LLM configuration)",
        },
      ],
      windows: [
        {
          method: "uv",
          command: "uv tool install openhands",
          description: "Install OpenHands CLI via uv (requires LLM configuration)",
        },
      ],
    },
    uninstallCommands: {
      unix: [
        {
          method: "uv",
          command: "uv tool uninstall openhands",
          description: "Uninstall via uv tool",
        },
      ],
      windows: [
        {
          method: "uv",
          command: "uv tool uninstall openhands",
          description: "Uninstall via uv tool",
        },
      ],
    },
  },
  {
    name: "Qwen Code",
    description: "AI-powered coding agent optimized for Qwen3-Coder models (experimental ACP)",
    command: "qwen",
    acpStartupArgs: ["--experimental-acp"],
    args: ["--experimental-acp"],
    installGuide: "https://github.com/QwenLM/qwen-code",
    color: "#888888",
    installCommands: {
      unix: [
        {
          method: "brew",
          command: "brew install qwen-code",
          description: "Install via Homebrew",
        },
        {
          method: "npm",
          command: "npm install -g @qwen-code/qwen-code@latest",
          description: "Install via npm (requires Node.js 20+)",
        },
      ],
      windows: [
        {
          method: "npm",
          command: "npm install -g @qwen-code/qwen-code@latest",
          description: "Install via npm (requires Node.js 20+)",
        },
      ],
    },
    uninstallCommands: {
      unix: [
        {
          method: "brew",
          command: "brew uninstall qwen-code",
          description: "Uninstall via Homebrew",
        },
        {
          method: "npm",
          command: "npm uninstall -g @qwen-code/qwen-code",
          description: "Uninstall via npm (global)",
        },
      ],
      windows: [
        {
          method: "npm",
          command: "npm uninstall -g @qwen-code/qwen-code",
          description: "Uninstall via npm (global)",
        },
      ],
    },
  },
  {
    name: "Stakpak",
    description: "Open source AI DevOps Agent",
    command: "stakpak",
    acpStartupArgs: ["acp"],
    args: ["acp"],
    installGuide: "https://github.com/stakpak/agent",
    color: "#1a83a0",
    installCommands: {
      unix: [
        {
          method: "brew",
          command: "brew tap stakpak/stakpak && brew install stakpak",
          description: "Install via Homebrew",
        },
      ],
      windows: [],
    },
    uninstallCommands: {
      unix: [
        {
          method: "brew",
          command: "brew uninstall stakpak",
          description: "Uninstall via Homebrew",
        },
      ],
      windows: [],
    },
  },
  {
    name: "VT Code",
    description: "Rust-based coding agent with ACP support",
    command: "vtcode",
    acpStartupArgs: ["acp"],
    args: ["acp"],
    installGuide: "https://github.com/vinhnx/vtcode",
    color: "#888888",
    installCommands: {
      unix: [
        {
          method: "curl",
          command: "curl -fsSL https://raw.githubusercontent.com/vinhnx/vtcode/main/scripts/install.sh | bash",
          description: "Install via official script",
        },
        {
          method: "brew",
          command: "brew install vinhnx/tap/vtcode",
          description: "Install via Homebrew",
        },
        {
          method: "cargo",
          command: "cargo install vtcode",
          description: "Install via Cargo",
        },
      ],
      windows: [
        {
          method: "powershell",
          command: "irm https://raw.githubusercontent.com/vinhnx/vtcode/main/scripts/install.ps1 | iex",
          description: "Install via PowerShell script",
        },
        {
          method: "cargo",
          command: "cargo install vtcode",
          description: "Install via Cargo",
        },
      ],
    },
    uninstallCommands: {
      unix: [
        {
          method: "brew",
          command: "brew uninstall vinhnx/tap/vtcode",
          description: "Uninstall via Homebrew",
        },
        {
          method: "cargo",
          command: "cargo uninstall vtcode",
          description: "Uninstall via Cargo",
        },
      ],
      windows: [
        {
          method: "cargo",
          command: "cargo uninstall vtcode",
          description: "Uninstall via Cargo",
        },
      ],
    },
  },
]
