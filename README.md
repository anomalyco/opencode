<div align="center">
<h1>Forge</h1>

**Universal CLI for coding agents, powered by the [Agent Client Protocol](https://agentclientprotocol.com/)**

`brew install forge`
<br />
`npm i -g @forge-agents/forge`

</div>

<img src="packages/site/public/images/terminal-ui.png">

## What is Forge/ACP?

Forge is a terminal interface for AI coding agents. It implements the Agent Client Protocol (ACP) - an open standard that lets any editor work with any agent, similar to how LSP standardized language servers.

**Key features:**

- **Multi-agent workflows** - Start planning with Claude Code, and then implement with Codex
- **Unified history** - Single conversation history across all agents
- **Shared MCP configuration** - Configure MCP servers once, use them across all agents
- **Growing agent ecosystem** - 15+ agents with new ones added weekly
- **Full ACP feature set** - Tool calls, session modes, agent plans, slash commands

## Why agent harnesses matter

Models and their harnesses are co-dependent. ACP lets you run each model in its purpose-built harness (Sonnet in Claude Code, GPT in Codex) instead of a one-size-fits-all solution.

For a deeper dive, see Viv Trivedy's great article [Claude Code SDK: HaaS (Harness as a Service)](https://www.vtrivedy.com/posts/claude-code-sdk-haas-harness-as-a-service).

## Supported Agents

Forge supports all agents listed at [agentclientprotocol.com/overview/agents](https://agentclientprotocol.com/overview/agents):

- [Augment Code](https://docs.augmentcode.com/cli/acp)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) (via Zed's SDK adapter)
- [Codex CLI](https://developers.openai.com/codex/cli) (via Zed's adapter)
- [Code Assistant](https://github.com/stippi/code-assistant?tab=readme-ov-file#configuration)
- [Docker's cagent](https://github.com/docker/cagent)
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

## Usage

### Multi-Agent Workflows

The `-a, --agent` flag accepts a fuzzy-matched string with space delimited parameters:

- `name` (required) - Agent name
- `model` (optional) - Model identifier (run `forge models <agentName>` to see available models)
- `mode` (optional) - Session mode like `plan` or `agent` (run `forge modes <agentName>` to see available modes)

You can chain multiple agents together - when an agent exits a mode, Forge automatically switches to the next agent in the chain.

```sh
# Plan with Claude, implement with Codex**
forge --agent "name=claude model=opus mode=plan" --agent "name=codex model=gpt-5.1-codex-max mode=agent" "Identify all of the TODO comments in this project and solve them"
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
  -a, --agent       repeatable agent spec: --agent "name=claude model=opus mode=plan"  [array]
  -h, --help        show help  [boolean]
  -v, --version     show version number  [boolean]
      --print-logs  print logs to stderr  [boolean]
      --log-level   log level  [string] [choices: "DEBUG", "INFO", "WARN", "ERROR"]
  -p, --print       Run headless, print response and exit  [boolean]
      --project     path to start forge in  [string]
  -c, --continue    continue the last session  [boolean]
  -s, --session     session id to continue  [string]
```
