<div align="center">
<h1>Forge</h1>

**Universal CLI for coding agents, powered by the [Agent Client Protocol](https://agentclientprotocol.com/)**

`brew install forge`
<br />
`npm i -g @forge-agents/forge`

</div>

<img src="packages/site/public/images/terminal-ui.png">

## Quickstart

Install globally using NPM or Homebrew

```sh
npm i -g @forge-agents/forge
brew install forge
```

Then run `forge` to get started:

```sh
forge
```

Try running Claude Code with a prompt:

```sh
forge --agent claude "Create our update my CLAUDE.md"
```

Try planning with Claude Code, and implementing with Codex:

```sh
forge --plan-agent "name=claude model=opus" --agent "name=codex model=gpt-5.1-codex-max" "Find all the TODO comments in the codebase and address the top 3"
```

## What is Forge/ACP?

Forge is a terminal interface for AI coding agents. It implements the [Agent Client Protocol](https://agentclientprotocol.com/) (ACP) - an open standard that lets any editor work with any agent, similar to how LSP standardized language servers.

**Key features:**

- **Multi-agent workflows** - Start planning with Claude Code, and then implement with Codex
- **Unified history** - Single conversation history across all agents
- **Shared MCP configuration** - Configure MCP servers once, use them across all agents
- **Growing agent ecosystem** - 15+ agents with new ones added weekly
- **Full ACP feature set** - Tool calls, session modes, agent plans, slash commands

## Why agent harnesses matter

Models and their harnesses are co-dependent. ACP lets you run each model in its purpose-built harness (Sonnet in Claude Code, GPT in Codex) instead of a one-size-fits-all solution.

This also enables hyper-specialized agents for domain-specific problems - like [Stakpak](https://github.com/stakpak/agent) for DevOps workflows, or custom agents built for your team's specific needs.

For a deeper dive, see Viv Trivedy's great article: [Agents Should Be More Opinionated](https://www.vtrivedy.com/posts/agents-should-be-more-opinionated).

## Supported Agents

Forge supports all agents listed at [agentclientprotocol.com/overview/agents](https://agentclientprotocol.com/overview/agents):

- [Augment Code](https://docs.augmentcode.com/cli/acp)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) (via Zed's SDK adapter)
- [Codex CLI](https://developers.openai.com/codex/cli) (via Zed's adapter)
- [Code Assistant](https://github.com/stippi/code-assistant?tab=readme-ov-file#configuration)
- [fast-agent](https://fast-agent.ai/acp)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Goose](https://block.github.io/goose/docs/guides/acp-clients)
- [JetBrains Junie](https://www.jetbrains.com/junie/) (coming soon)
- [Kimi CLI](https://github.com/MoonshotAI/kimi-cli)
- [LLMling-Agent](https://phil65.github.io/llmling-agent/advanced/acp_integration/)
- [Mistral Vibe](https://github.com/mistralai/mistral-vibe)
- [OpenCode](https://github.com/sst/opencode)
- [OpenHands](https://docs.openhands.dev/openhands/usage/run-openhands/acp)
- [Qwen Code](https://github.com/QwenLM/qwen-code)
- [Stakpak](https://github.com/stakpak/agent?tab=readme-ov-file#agent-client-protocol-acp)
- [VT Code](https://github.com/vinhnx/vtcode/blob/main/README.md#zed-ide-integration-agent-client-protocol)

Run `forge agents` to see the full list.

### Install/uninstall agents

- **Note:** Claude Code and Codex aren’t ACP-native yet. The `claude` and `codex` entries point to Zed’s ACP wrappers (`@zed-industries/claude-code-acp` and `@zed-industries/codex-acp`), which you’ll need to install.

- Install an agent from the CLI:

```sh
forge install <agentName>
```

- Uninstall an agent from the CLI:

```sh
forge uninstall <agentName>
```

## Usage

### Plan With One Agent, Implement With Another

Agents that expose a `plan` session mode today: Claude Code, OpenCode.

Use `--plan-agent` and `--agent` to split planning and implementation. Both accept either an agent name (`--agent claude`) or parameters (`--agent "name=claude model=opus mode=acceptEdits"`):

**Agent parameters**

- `name` (required) - Agent name
- `model` (optional) - Model identifier (`forge models <agent>` to see options)
- `mode` (optional) - Session mode (`forge modes <agent>` to see options)

When `--plan-agent` [exits plan mode](https://agentclientprotocol.com/protocol/session-modes#exiting-plan-modes), Forge automatically switches to `--agent` for implementation.

> Note that all fields support fuzzy matching

**Example: Plan with Claude, implement with Codex**

```sh
forge --plan-agent "name=claude model=opus" --agent "name=codex model=gpt-5.1-codex-max" "Find all TODOs and address the top 3"
```

### Commands & Flags

```sh
Commands:
  forge [prompt]            start forge tui  [default]
  forge agents              list all available ACP agents
  forge models <agentName>  list available models for an ACP agent
  forge upgrade [target]    upgrade forge to the latest or a specific version

Positionals:
  prompt  prompt to send  [string]

Options:
  -a, --agent       agent spec: --agent claude or --agent "name=claude model=opus mode=bypassPermissions"  [string]
      --plan-agent  plan agent spec: --plan-agent claude or --plan-agent "name=claude model=opus"  [string]
  -h, --help        show help  [boolean]
  -v, --version     show version number  [boolean]
      --print-logs  print logs to stderr  [boolean]
      --log-level   log level  [string] [choices: "DEBUG", "INFO", "WARN", "ERROR"]
  -p, --print       Run headless, print response and exit  [boolean]
      --project     path to start forge in  [string]
  -c, --continue    continue the last session  [boolean]
  -s, --session     session id to continue  [string]
```

## Share feedback

Have feedback, found a bug, or want to request a feature? Open the command palette (default: `Ctrl+P`) and select **"Share feedback"** to create a GitHub issue. You can also directly visit [github.com/forge-agents/forge/issues](https://github.com/forge-agents/forge/issues).
