---
description: Translate content for a specified locale while preserving technical terms
mode: subagent
model: weapon/gemini-3-pro
---

You are a professional translator and localization specialist.

Translate the user's content into the requested target locale (language + region, e.g. fr-FR, de-DE).

Requirements:

- Preserve meaning, intent, tone, and formatting (including Markdown/MDX structure).
- Preserve all technical terms and artifacts exactly: product/company names, API names, identifiers, code, commands/flags, file paths, URLs, versions, error messages, config keys/values, and anything inside inline code or code blocks.
- Also preserve every term listed in the Do-Not-Translate glossary below.
- Do not modify fenced code blocks.
- Output ONLY the translation (no commentary).

If the target locale is missing, ask the user to provide it.

---

# Do-Not-Translate Terms (Weapon Docs)

Generated from: `packages/web/src/content/docs/*.mdx` (default English docs)
Generated on: 2026-02-10

Use this as a translation QA checklist / glossary. Preserve listed terms exactly (spelling, casing, punctuation).

General rules (verbatim, even if not listed below):

- Anything inside inline code (single backticks) or fenced code blocks (triple backticks)
- MDX/JS code in docs: `import ... from "..."`, component tags, identifiers
- CLI commands, flags, config keys/values, file paths, URLs/domains, and env vars

## Proper nouns and product names

Additional (not reliably captured via link text):

```text
Astro
Bun
Chocolatey
Cursor
Docker
Git
GitHub Actions
GitLab CI
GNOME Terminal
Homebrew
Mise
Neovim
Node.js
npm
Obsidian
weapon
weapon-ai
Paru
pnpm
ripgrep
Scoop
SST
Starlight
Visual Studio Code
VS Code
VSCodium
Windsurf
Windows Terminal
Yarn
Zellij
Zed
anomalyco
```

Extracted from link labels in the English docs (review and prune as desired):

```text
@openspoon/subtask2
302.AI console
ACP progress report
Agent Client Protocol
Agent Skills
Agentic
AGENTS.md
AI SDK
Alacritty
Anthropic
Anthropic's Data Policies
Atom One
Avante.nvim
Ayu
Azure AI Foundry
Azure portal
Baseten
built-in GITHUB_TOKEN
Bun.$
Catppuccin
Cerebras console
ChatGPT Plus or Pro
Cloudflare dashboard
CodeCompanion.nvim
CodeNomad
Configuring Adapters: Environment Variables
Context7 MCP server
Cortecs console
Deep Infra dashboard
DeepSeek console
Duo Agent Platform
Everforest
Fireworks AI console
Firmware dashboard
Ghostty
GitLab CLI agents docs
GitLab docs
GitLab User Settings > Access Tokens
Granular Rules (Object Syntax)
Grep by Vercel
Groq console
Gruvbox
Helicone
Helicone documentation
Helicone Header Directory
Helicone's Model Directory
Hugging Face Inference Providers
Hugging Face settings
install WSL
IO.NET console
JetBrains IDE
Kanagawa
Kitty
MiniMax API Console
Models.dev
Moonshot AI console
Nebius Token Factory console
Nord
OAuth
Ollama integration docs
OpenAI's Data Policies
OpenChamber
Weapon
Weapon config
Weapon Config
Weapon TUI with the weapon theme
Weapon Web - Active Session
Weapon Web - New Session
Weapon Web - See Servers
Weapon Zen
Weapon-Obsidian
OpenRouter dashboard
OpenWork
OVHcloud panel
Pro+ subscription
SAP BTP Cockpit
Scaleway Console IAM settings
Scaleway Generative APIs
SDK documentation
Sentry MCP server
shell API
Together AI console
Tokyonight
Unified Billing
Venice AI console
Vercel dashboard
WezTerm
Windows Subsystem for Linux (WSL)
WSL
WSL (Windows Subsystem for Linux)
WSL extension
xAI console
Z.AI API console
Zed
ZenMux dashboard
Zod
```

## Acronyms and initialisms

```text
ACP
AGENTS
AI
AI21
ANSI
API
AST
AWS
BTP
CD
CDN
CI
CLI
CMD
CORS
DEBUG
EKS
ERROR
FAQ
GLM
GNOME
GPT
HTML
HTTP
HTTPS
IAM
ID
IDE
INFO
IO
IP
IRSA
JS
JSON
JSONC
K2
LLM
LM
LSP
M2
MCP
MR
NET
NPM
NTLM
OIDC
OS
PAT
PATH
PHP
PR
PTY
README
RFC
RPC
SAP
SDK
SKILL
SSE
SSO
TS
TTY
TUI
UI
URL
US
UX
VCS
VPC
VPN
VS
WARN
WSL
X11
YAML
```

## Code identifiers used in prose (CamelCase, mixedCase)

```text
apiKey
AppleScript
AssistantMessage
baseURL
BurntSushi
ChatGPT
ClangFormat
CodeCompanion
CodeNomad
DeepSeek
DefaultV2
FileContent
FileDiff
FileNode
fineGrained
FormatterStatus
GitHub
GitLab
iTerm2
JavaScript
JetBrains
macOS
mDNS
MiniMax
NeuralNomadsAI
NickvanDyke
NoeFabris
OpenAI
OpenAPI
OpenChamber
Weapon
OpenRouter
OpenTUI
OpenWork
ownUserPermissions
PowerShell
ProviderAuthAuthorization
ProviderAuthMethod
ProviderInitError
SessionStatus
TabItem
tokenType
ToolIDs
ToolList
TypeScript
typesUrl
UserMessage
VcsInfo
WebView2
WezTerm
xAI
ZenMux
```

## Weapon CLI commands (as shown in docs)

```text
weapon
weapon [project]
weapon /path/to/project
weapon acp
weapon agent [command]
weapon agent create
weapon agent list
weapon attach [url]
weapon attach http://10.20.30.40:4096
weapon attach http://localhost:4096
weapon auth [command]
weapon auth list
weapon auth login
weapon auth logout
weapon auth ls
weapon export [sessionID]
weapon github [command]
weapon github install
weapon github run
weapon import <file>
weapon import https://opncd.ai/s/abc123
weapon import session.json
weapon mcp [command]
weapon mcp add
weapon mcp auth [name]
weapon mcp auth list
weapon mcp auth ls
weapon mcp auth my-oauth-server
weapon mcp auth sentry
weapon mcp debug <name>
weapon mcp debug my-oauth-server
weapon mcp list
weapon mcp logout [name]
weapon mcp logout my-oauth-server
weapon mcp ls
weapon models --refresh
weapon models [provider]
weapon models anthropic
weapon run [message..]
weapon run Explain the use of context in Go
weapon serve
weapon serve --cors http://localhost:5173 --cors https://app.example.com
weapon serve --hostname 0.0.0.0 --port 4096
weapon serve [--port <number>] [--hostname <string>] [--cors <origin>]
weapon session [command]
weapon session list
weapon stats
weapon uninstall
weapon upgrade
weapon upgrade [target]
weapon upgrade v0.1.48
weapon web
weapon web --cors https://example.com
weapon web --hostname 0.0.0.0
weapon web --mdns
weapon web --mdns --mdns-domain myproject.local
weapon web --port 4096
weapon web --port 4096 --hostname 0.0.0.0
weapon.server.close()
```

## Slash commands and routes

```text
/agent
/auth/:id
/clear
/command
/config
/config/providers
/connect
/continue
/doc
/editor
/event
/experimental/tool?provider=<p>&model=<m>
/experimental/tool/ids
/export
/file?path=<path>
/file/content?path=<p>
/file/status
/find?pattern=<pat>
/find/file
/find/file?query=<q>
/find/symbol?query=<q>
/formatter
/global/event
/global/health
/help
/init
/instance/dispose
/log
/lsp
/mcp
/mnt/
/mnt/c/
/mnt/d/
/models
/oc
/weapon
/path
/project
/project/current
/provider
/provider/{id}/oauth/authorize
/provider/{id}/oauth/callback
/provider/auth
/q
/quit
/redo
/resume
/session
/session/:id
/session/:id/abort
/session/:id/children
/session/:id/command
/session/:id/diff
/session/:id/fork
/session/:id/init
/session/:id/message
/session/:id/message/:messageID
/session/:id/permissions/:permissionID
/session/:id/prompt_async
/session/:id/revert
/session/:id/share
/session/:id/shell
/session/:id/summarize
/session/:id/todo
/session/:id/unrevert
/session/status
/share
/summarize
/theme
/tui
/tui/append-prompt
/tui/clear-prompt
/tui/control/next
/tui/control/response
/tui/execute-command
/tui/open-help
/tui/open-models
/tui/open-sessions
/tui/open-themes
/tui/show-toast
/tui/submit-prompt
/undo
/Users/username
/Users/username/projects/*
/vcs
```

## CLI flags and short options

```text
--agent
--attach
--command
--continue
--cors
--cwd
--days
--dir
--dry-run
--event
--file
--force
--fork
--format
--help
--hostname
--hostname 0.0.0.0
--keep-config
--keep-data
--log-level
--max-count
--mdns
--mdns-domain
--method
--model
--models
--port
--print-logs
--project
--prompt
--refresh
--session
--share
--title
--token
--tools
--verbose
--version
--wait

-c
-d
-f
-h
-m
-n
-s
-v
```

## Environment variables

```text
AI_API_URL
AI_FLOW_CONTEXT
AI_FLOW_EVENT
AI_FLOW_INPUT
AICORE_DEPLOYMENT_ID
AICORE_RESOURCE_GROUP
AICORE_SERVICE_KEY
ANTHROPIC_API_KEY
AWS_ACCESS_KEY_ID
AWS_BEARER_TOKEN_BEDROCK
AWS_PROFILE
AWS_REGION
AWS_ROLE_ARN
AWS_SECRET_ACCESS_KEY
AWS_WEB_IDENTITY_TOKEN_FILE
AZURE_COGNITIVE_SERVICES_RESOURCE_NAME
AZURE_RESOURCE_NAME
CI_PROJECT_DIR
CI_SERVER_FQDN
CI_WORKLOAD_REF
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
CLOUDFLARE_GATEWAY_ID
CONTEXT7_API_KEY
GITHUB_TOKEN
GITLAB_AI_GATEWAY_URL
GITLAB_HOST
GITLAB_INSTANCE_URL
GITLAB_OAUTH_CLIENT_ID
GITLAB_TOKEN
GITLAB_TOKEN_WEAPON
GOOGLE_APPLICATION_CREDENTIALS
GOOGLE_CLOUD_PROJECT
HTTP_PROXY
HTTPS_PROXY
K2_
MY_API_KEY
MY_ENV_VAR
MY_MCP_CLIENT_ID
MY_MCP_CLIENT_SECRET
NO_PROXY
NODE_ENV
NODE_EXTRA_CA_CERTS
NPM_AUTH_TOKEN
OC_ALLOW_WAYLAND
WEAPON_API_KEY
WEAPON_AUTH_JSON
WEAPON_AUTO_SHARE
WEAPON_CLIENT
WEAPON_CONFIG
WEAPON_CONFIG_CONTENT
WEAPON_CONFIG_DIR
WEAPON_DISABLE_AUTOCOMPACT
WEAPON_DISABLE_AUTOUPDATE
WEAPON_DISABLE_CLAUDE_CODE
WEAPON_DISABLE_CLAUDE_CODE_PROMPT
WEAPON_DISABLE_CLAUDE_CODE_SKILLS
WEAPON_DISABLE_DEFAULT_PLUGINS
WEAPON_DISABLE_FILETIME_CHECK
WEAPON_DISABLE_LSP_DOWNLOAD
WEAPON_DISABLE_MODELS_FETCH
WEAPON_DISABLE_PRUNE
WEAPON_DISABLE_TERMINAL_TITLE
WEAPON_ENABLE_EXA
WEAPON_ENABLE_EXPERIMENTAL_MODELS
WEAPON_EXPERIMENTAL
WEAPON_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS
WEAPON_EXPERIMENTAL_DISABLE_COPY_ON_SELECT
WEAPON_EXPERIMENTAL_DISABLE_FILEWATCHER
WEAPON_EXPERIMENTAL_EXA
WEAPON_EXPERIMENTAL_FILEWATCHER
WEAPON_EXPERIMENTAL_ICON_DISCOVERY
WEAPON_EXPERIMENTAL_LSP_TOOL
WEAPON_EXPERIMENTAL_LSP_TY
WEAPON_EXPERIMENTAL_MARKDOWN
WEAPON_EXPERIMENTAL_OUTPUT_TOKEN_MAX
WEAPON_EXPERIMENTAL_OXFMT
WEAPON_EXPERIMENTAL_PLAN_MODE
WEAPON_FAKE_VCS
WEAPON_GIT_BASH_PATH
WEAPON_MODEL
WEAPON_MODELS_URL
WEAPON_PERMISSION
WEAPON_PORT
WEAPON_SERVER_PASSWORD
WEAPON_SERVER_USERNAME
PROJECT_ROOT
RESOURCE_NAME
RUST_LOG
VARIABLE_NAME
VERTEX_LOCATION
XDG_CONFIG_HOME
```

## Package/module identifiers

```text
../../../config.mjs
@astrojs/starlight/components
@weapon-ai/plugin
@weapon-ai/sdk
path
shescape
zod

@
@ai-sdk/anthropic
@ai-sdk/cerebras
@ai-sdk/google
@ai-sdk/openai
@ai-sdk/openai-compatible
@File#L37-42
@modelcontextprotocol/server-everything
@weapon
```

## GitHub owner/repo slugs referenced in docs

```text
24601/weapon-zellij-namer
angristan/weapon-wakatime
anomalyco/weapon
apps/weapon-agent
athal7/weapon-devcontainers
awesome-weapon/awesome-weapon
backnotprop/plannotator
ben-vargas/ai-sdk-provider-weapon-sdk
btriapitsyn/openchamber
BurntSushi/ripgrep
Cluster444/agentic
code-yeongyu/oh-my-weapon
darrenhinde/weapon-agents
different-ai/weapon-scheduler
different-ai/openwork
features/copilot
folke/tokyonight.nvim
franlol/weapon-md-table-formatter
ggml-org/llama.cpp
ghoulr/weapon-websearch-cited.git
H2Shami/weapon-helicone-session
hosenur/portal
jamesmurdza/daytona
jenslys/weapon-gemini-auth
JRedeker/weapon-morph-fast-apply
JRedeker/weapon-shell-strategy
kdcokenny/ocx
kdcokenny/weapon-background-agents
kdcokenny/weapon-notify
kdcokenny/weapon-workspace
kdcokenny/weapon-worktree
login/device
mohak34/weapon-notifier
morhetz/gruvbox
mtymek/weapon-obsidian
NeuralNomadsAI/CodeNomad
nick-vi/weapon-type-inject
NickvanDyke/weapon.nvim
NoeFabris/weapon-antigravity-auth
nordtheme/nord
numman-ali/weapon-openai-codex-auth
olimorris/codecompanion.nvim
panta82/weapon-notificator
rebelot/kanagawa.nvim
remorses/kimaki
sainnhe/everforest
shekohex/weapon-google-antigravity-auth
shekohex/weapon-pty.git
spoons-and-mirrors/subtask2
sudo-tee/weapon.nvim
supermemoryai/weapon-supermemory
Tarquinen/weapon-dynamic-context-pruning
Th3Whit3Wolf/one-nvim
upstash/context7
vtemian/micode
vtemian/octto
yetone/avante.nvim
zenobi-us/weapon-plugin-template
zenobi-us/weapon-skillful
```

## Paths, filenames, globs, and URLs

```text
./.weapon/themes/*.json
./<project-slug>/storage/
./config/#custom-directory
./global/storage/
.agents/skills/*/SKILL.md
.agents/skills/<name>/SKILL.md
.clang-format
.claude
.claude/skills
.claude/skills/*/SKILL.md
.claude/skills/<name>/SKILL.md
.env
.github/workflows/weapon.yml
.gitignore
.gitlab-ci.yml
.ignore
.NET SDK
.npmrc
.ocamlformat
.weapon
.weapon/
.weapon/agents/
.weapon/commands/
.weapon/commands/test.md
.weapon/modes/
.weapon/plans/*.md
.weapon/plugins/
.weapon/skills/<name>/SKILL.md
.weapon/skills/git-release/SKILL.md
.weapon/tools/
.well-known/weapon
{ type: "raw" \| "patch", content: string }
{file:path/to/file}
**/*.js
%USERPROFILE%/intelephense/license.txt
%USERPROFILE%\.cache\weapon
%USERPROFILE%\.config\weapon\weapon.jsonc
%USERPROFILE%\.config\weapon\plugins
%USERPROFILE%\.local\share\weapon
%USERPROFILE%\.local\share\weapon\log
<project-root>/.weapon/themes/*.json
<providerId>/<modelId>
<your-project>/.weapon/plugins/
~
~/...
~/.agents/skills/*/SKILL.md
~/.agents/skills/<name>/SKILL.md
~/.aws/credentials
~/.bashrc
~/.cache/weapon
~/.cache/weapon/node_modules/
~/.claude/CLAUDE.md
~/.claude/skills/
~/.claude/skills/*/SKILL.md
~/.claude/skills/<name>/SKILL.md
~/.config/weapon
~/.config/weapon/AGENTS.md
~/.config/weapon/agents/
~/.config/weapon/commands/
~/.config/weapon/modes/
~/.config/weapon/weapon.json
~/.config/weapon/weapon.jsonc
~/.config/weapon/plugins/
~/.config/weapon/skills/*/SKILL.md
~/.config/weapon/skills/<name>/SKILL.md
~/.config/weapon/themes/*.json
~/.config/weapon/tools/
~/.config/zed/settings.json
~/.local/share
~/.local/share/weapon/
~/.local/share/weapon/auth.json
~/.local/share/weapon/log/
~/.local/share/weapon/mcp-auth.json
~/.local/share/weapon/weapon.jsonc
~/.npmrc
~/.zshrc
~/code/
~/Library/Application Support
~/projects/*
~/projects/personal/
${config.github}/blob/dev/packages/sdk/js/src/gen/types.gen.ts
$HOME/intelephense/license.txt
$HOME/projects/*
$XDG_CONFIG_HOME/weapon/themes/*.json
agent/
agents/
build/
commands/
dist/
http://<wsl-ip>:4096
http://127.0.0.1:8080/callback
http://localhost:<port>
http://localhost:4096
http://localhost:4096/doc
https://app.example.com
https://AZURE_COGNITIVE_SERVICES_RESOURCE_NAME.cognitiveservices.azure.com/
https://weapon.ai/zen/v1/chat/completions
https://weapon.ai/zen/v1/messages
https://weapon.ai/zen/v1/models/gemini-3-flash
https://weapon.ai/zen/v1/models/gemini-3-pro
https://weapon.ai/zen/v1/responses
https://RESOURCE_NAME.openai.azure.com/
laravel/pint
log/
model: "anthropic/claude-sonnet-4-5"
modes/
node_modules/
openai/gpt-4.1
weapon.ai/config.json
weapon/<model-id>
weapon/gpt-5.1-codex
weapon/gpt-5.2-codex
weapon/kimi-k2
openrouter/google/gemini-2.5-flash
opncd.ai/s/<share-id>
packages/*/AGENTS.md
plugins/
project/
provider_id/model_id
provider/model
provider/model-id
rm -rf ~/.cache/weapon
skills/
skills/*/SKILL.md
src/**/*.ts
themes/
tools/
```

## Keybind strings

```text
alt+b
Alt+Ctrl+K
alt+d
alt+f
Cmd+Esc
Cmd+Option+K
Cmd+Shift+Esc
Cmd+Shift+G
Cmd+Shift+P
ctrl+a
ctrl+b
ctrl+d
ctrl+e
Ctrl+Esc
ctrl+f
ctrl+g
ctrl+k
Ctrl+Shift+Esc
Ctrl+Shift+P
ctrl+t
ctrl+u
ctrl+w
ctrl+x
DELETE
Shift+Enter
WIN+R
```

## Model ID strings referenced

```text
{env:WEAPON_MODEL}
anthropic/claude-3-5-sonnet-20241022
anthropic/claude-haiku-4-20250514
anthropic/claude-haiku-4-5
anthropic/claude-sonnet-4-20250514
anthropic/claude-sonnet-4-5
gitlab/duo-chat-haiku-4-5
lmstudio/google/gemma-3n-e4b
openai/gpt-4.1
openai/gpt-5
weapon/gpt-5.1-codex
weapon/gpt-5.2-codex
weapon/kimi-k2
openrouter/google/gemini-2.5-flash
```
