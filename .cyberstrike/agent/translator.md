---
description: Translate content for a specified locale while preserving technical terms
mode: subagent
model: cyberstrike/gemini-3-pro
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

# Do-Not-Translate Terms (CyberStrike Docs)

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
cyberstrike
cyberstrike-ai
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
CyberStrikeus
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
CyberStrike
CyberStrike config
CyberStrike Config
CyberStrike TUI with the cyberstrike theme
CyberStrike Web - Active Session
CyberStrike Web - New Session
CyberStrike Web - See Servers
CyberStrike Zen
CyberStrike-Obsidian
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
CyberStrike
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

## CyberStrike CLI commands (as shown in docs)

```text
cyberstrike
cyberstrike [project]
cyberstrike /path/to/project
cyberstrike acp
cyberstrike agent [command]
cyberstrike agent create
cyberstrike agent list
cyberstrike attach [url]
cyberstrike attach http://10.20.30.40:4096
cyberstrike attach http://localhost:4096
cyberstrike auth [command]
cyberstrike auth list
cyberstrike auth login
cyberstrike auth logout
cyberstrike auth ls
cyberstrike export [sessionID]
cyberstrike github [command]
cyberstrike github install
cyberstrike github run
cyberstrike import <file>
cyberstrike import https://opncd.ai/s/abc123
cyberstrike import session.json
cyberstrike mcp [command]
cyberstrike mcp add
cyberstrike mcp auth [name]
cyberstrike mcp auth list
cyberstrike mcp auth ls
cyberstrike mcp auth my-oauth-server
cyberstrike mcp auth sentry
cyberstrike mcp debug <name>
cyberstrike mcp debug my-oauth-server
cyberstrike mcp list
cyberstrike mcp logout [name]
cyberstrike mcp logout my-oauth-server
cyberstrike mcp ls
cyberstrike models --refresh
cyberstrike models [provider]
cyberstrike models anthropic
cyberstrike run [message..]
cyberstrike run Explain the use of context in Go
cyberstrike serve
cyberstrike serve --cors http://localhost:5173 --cors https://app.example.com
cyberstrike serve --hostname 0.0.0.0 --port 4096
cyberstrike serve [--port <number>] [--hostname <string>] [--cors <origin>]
cyberstrike session [command]
cyberstrike session list
cyberstrike stats
cyberstrike uninstall
cyberstrike upgrade
cyberstrike upgrade [target]
cyberstrike upgrade v0.1.48
cyberstrike web
cyberstrike web --cors https://example.com
cyberstrike web --hostname 0.0.0.0
cyberstrike web --mdns
cyberstrike web --mdns --mdns-domain myproject.local
cyberstrike web --port 4096
cyberstrike web --port 4096 --hostname 0.0.0.0
cyberstrike.server.close()
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
/cyberstrike
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
GITLAB_TOKEN_CYBERSTRIKE
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
CYBERSTRIKE_API_KEY
CYBERSTRIKE_AUTH_JSON
CYBERSTRIKE_AUTO_SHARE
CYBERSTRIKE_CLIENT
CYBERSTRIKE_CONFIG
CYBERSTRIKE_CONFIG_CONTENT
CYBERSTRIKE_CONFIG_DIR
CYBERSTRIKE_DISABLE_AUTOCOMPACT
CYBERSTRIKE_DISABLE_AUTOUPDATE
CYBERSTRIKE_DISABLE_CLAUDE_CODE
CYBERSTRIKE_DISABLE_CLAUDE_CODE_PROMPT
CYBERSTRIKE_DISABLE_CLAUDE_CODE_SKILLS
CYBERSTRIKE_DISABLE_DEFAULT_PLUGINS
CYBERSTRIKE_DISABLE_FILETIME_CHECK
CYBERSTRIKE_DISABLE_LSP_DOWNLOAD
CYBERSTRIKE_DISABLE_MODELS_FETCH
CYBERSTRIKE_DISABLE_PRUNE
CYBERSTRIKE_DISABLE_TERMINAL_TITLE
CYBERSTRIKE_ENABLE_EXA
CYBERSTRIKE_ENABLE_EXPERIMENTAL_MODELS
CYBERSTRIKE_EXPERIMENTAL
CYBERSTRIKE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS
CYBERSTRIKE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT
CYBERSTRIKE_EXPERIMENTAL_DISABLE_FILEWATCHER
CYBERSTRIKE_EXPERIMENTAL_EXA
CYBERSTRIKE_EXPERIMENTAL_FILEWATCHER
CYBERSTRIKE_EXPERIMENTAL_ICON_DISCOVERY
CYBERSTRIKE_EXPERIMENTAL_LSP_TOOL
CYBERSTRIKE_EXPERIMENTAL_LSP_TY
CYBERSTRIKE_EXPERIMENTAL_MARKDOWN
CYBERSTRIKE_EXPERIMENTAL_OUTPUT_TOKEN_MAX
CYBERSTRIKE_EXPERIMENTAL_OXFMT
CYBERSTRIKE_EXPERIMENTAL_PLAN_MODE
CYBERSTRIKE_FAKE_VCS
CYBERSTRIKE_GIT_BASH_PATH
CYBERSTRIKE_MODEL
CYBERSTRIKE_MODELS_URL
CYBERSTRIKE_PERMISSION
CYBERSTRIKE_PORT
CYBERSTRIKE_SERVER_PASSWORD
CYBERSTRIKE_SERVER_USERNAME
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
@cyberstrike-ai/plugin
@cyberstrike-ai/sdk
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
@cyberstrike
```

## GitHub owner/repo slugs referenced in docs

```text
24601/cyberstrike-zellij-namer
angristan/cyberstrike-wakatime
CyberStrikeus/cyberstrike
apps/cyberstrike-agent
athal7/cyberstrike-devcontainers
awesome-cyberstrike/awesome-cyberstrike
backnotprop/plannotator
ben-vargas/ai-sdk-provider-cyberstrike-sdk
btriapitsyn/openchamber
BurntSushi/ripgrep
Cluster444/agentic
code-yeongyu/oh-my-cyberstrike
darrenhinde/cyberstrike-agents
different-ai/cyberstrike-scheduler
different-ai/openwork
features/copilot
folke/tokyonight.nvim
franlol/cyberstrike-md-table-formatter
ggml-org/llama.cpp
ghoulr/cyberstrike-websearch-cited.git
H2Shami/cyberstrike-helicone-session
hosenur/portal
jamesmurdza/daytona
jenslys/cyberstrike-gemini-auth
JRedeker/cyberstrike-morph-fast-apply
JRedeker/cyberstrike-shell-strategy
kdcokenny/ocx
kdcokenny/cyberstrike-background-agents
kdcokenny/cyberstrike-notify
kdcokenny/cyberstrike-workspace
kdcokenny/cyberstrike-worktree
login/device
mohak34/cyberstrike-notifier
morhetz/gruvbox
mtymek/cyberstrike-obsidian
NeuralNomadsAI/CodeNomad
nick-vi/cyberstrike-type-inject
NickvanDyke/cyberstrike.nvim
NoeFabris/cyberstrike-antigravity-auth
nordtheme/nord
numman-ali/cyberstrike-openai-codex-auth
olimorris/codecompanion.nvim
panta82/cyberstrike-notificator
rebelot/kanagawa.nvim
remorses/kimaki
sainnhe/everforest
shekohex/cyberstrike-google-antigravity-auth
shekohex/cyberstrike-pty.git
spoons-and-mirrors/subtask2
sudo-tee/cyberstrike.nvim
supermemoryai/cyberstrike-supermemory
Tarquinen/cyberstrike-dynamic-context-pruning
Th3Whit3Wolf/one-nvim
upstash/context7
vtemian/micode
vtemian/octto
yetone/avante.nvim
zenobi-us/cyberstrike-plugin-template
zenobi-us/cyberstrike-skillful
```

## Paths, filenames, globs, and URLs

```text
./.cyberstrike/themes/*.json
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
.github/workflows/cyberstrike.yml
.gitignore
.gitlab-ci.yml
.ignore
.NET SDK
.npmrc
.ocamlformat
.cyberstrike
.cyberstrike/
.cyberstrike/agents/
.cyberstrike/commands/
.cyberstrike/commands/test.md
.cyberstrike/modes/
.cyberstrike/plans/*.md
.cyberstrike/plugins/
.cyberstrike/skills/<name>/SKILL.md
.cyberstrike/skills/git-release/SKILL.md
.cyberstrike/tools/
.well-known/cyberstrike
{ type: "raw" \| "patch", content: string }
{file:path/to/file}
**/*.js
%USERPROFILE%/intelephense/license.txt
%USERPROFILE%\.cache\cyberstrike
%USERPROFILE%\.config\cyberstrike\cyberstrike.jsonc
%USERPROFILE%\.config\cyberstrike\plugins
%USERPROFILE%\.local\share\cyberstrike
%USERPROFILE%\.local\share\cyberstrike\log
<project-root>/.cyberstrike/themes/*.json
<providerId>/<modelId>
<your-project>/.cyberstrike/plugins/
~
~/...
~/.agents/skills/*/SKILL.md
~/.agents/skills/<name>/SKILL.md
~/.aws/credentials
~/.bashrc
~/.cache/cyberstrike
~/.cache/cyberstrike/node_modules/
~/.claude/CLAUDE.md
~/.claude/skills/
~/.claude/skills/*/SKILL.md
~/.claude/skills/<name>/SKILL.md
~/.config/cyberstrike
~/.config/cyberstrike/AGENTS.md
~/.config/cyberstrike/agents/
~/.config/cyberstrike/commands/
~/.config/cyberstrike/modes/
~/.config/cyberstrike/cyberstrike.json
~/.config/cyberstrike/cyberstrike.jsonc
~/.config/cyberstrike/plugins/
~/.config/cyberstrike/skills/*/SKILL.md
~/.config/cyberstrike/skills/<name>/SKILL.md
~/.config/cyberstrike/themes/*.json
~/.config/cyberstrike/tools/
~/.config/zed/settings.json
~/.local/share
~/.local/share/cyberstrike/
~/.local/share/cyberstrike/auth.json
~/.local/share/cyberstrike/log/
~/.local/share/cyberstrike/mcp-auth.json
~/.local/share/cyberstrike/cyberstrike.jsonc
~/.npmrc
~/.zshrc
~/code/
~/Library/Application Support
~/projects/*
~/projects/personal/
${config.github}/blob/dev/packages/sdk/js/src/gen/types.gen.ts
$HOME/intelephense/license.txt
$HOME/projects/*
$XDG_CONFIG_HOME/cyberstrike/themes/*.json
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
https://cyberstrike.io/zen/v1/chat/completions
https://cyberstrike.io/zen/v1/messages
https://cyberstrike.io/zen/v1/models/gemini-3-flash
https://cyberstrike.io/zen/v1/models/gemini-3-pro
https://cyberstrike.io/zen/v1/responses
https://RESOURCE_NAME.openai.azure.com/
laravel/pint
log/
model: "anthropic/claude-sonnet-4-5"
modes/
node_modules/
openai/gpt-4.1
cyberstrike.io/config.json
cyberstrike/<model-id>
cyberstrike/gpt-5.1-codex
cyberstrike/gpt-5.2-codex
cyberstrike/kimi-k2
openrouter/google/gemini-2.5-flash
opncd.ai/s/<share-id>
packages/*/AGENTS.md
plugins/
project/
provider_id/model_id
provider/model
provider/model-id
rm -rf ~/.cache/cyberstrike
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
{env:CYBERSTRIKE_MODEL}
anthropic/claude-3-5-sonnet-20241022
anthropic/claude-haiku-4-20250514
anthropic/claude-haiku-4-5
anthropic/claude-sonnet-4-20250514
anthropic/claude-sonnet-4-5
gitlab/duo-chat-haiku-4-5
lmstudio/google/gemma-3n-e4b
openai/gpt-4.1
openai/gpt-5
cyberstrike/gpt-5.1-codex
cyberstrike/gpt-5.2-codex
cyberstrike/kimi-k2
openrouter/google/gemini-2.5-flash
```
