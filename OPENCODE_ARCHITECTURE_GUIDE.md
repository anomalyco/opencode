# OpenCode Architecture Guide

Complete architectural analysis and visual diagrams for understanding the OpenCode project.

## Table of Contents
1. [Project Overview](#project-overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Package Structure](#package-structure)
4. [Core Systems](#core-systems)
5. [Data Flow](#data-flow)
6. [Feature Implementation](#feature-implementation)
7. [Build and Deployment](#build-and-deployment)
8. [How to Use in Your Project](#how-to-use-in-your-project)

---

## Project Overview

**OpenCode** is an open-source AI coding assistant that provides a terminal-based and desktop development environment powered by AI. It's designed as a provider-agnostic alternative to proprietary AI coding tools.

### Key Stats
- **Version**: 1.0.209
- **License**: MIT
- **Language**: TypeScript 5.8.2
- **Runtime**: Bun 1.3.5
- **UI Framework**: SolidJS 1.9.10
- **Supported Providers**: 15+ LLM providers (Anthropic, OpenAI, Google, etc.)

---

## High-Level Architecture

```mermaid
graph TB
    subgraph "User Interfaces"
        CLI[CLI Terminal]
        Web[Web Console]
        Desktop[Desktop App]
    end

    subgraph "Core Engine packages/opencode"
        Router[Command Router]
        SessionMgr[Session Manager]
        AgentSys[Agent System]
        ToolRegistry[Tool Registry]
    end

    subgraph "Integration Layer"
        ProviderMgr[Provider Manager]
        MCPClient[MCP Client]
        LSPClient[LSP Client]
        GitClient[Git Client]
    end

    subgraph "External Services"
        LLMs[LLM Providers<br/>Anthropic, OpenAI, etc.]
        MCPServers[MCP Servers<br/>External Tools]
        LSPServers[LSP Servers<br/>Language Support]
        GitHub[GitHub API]
    end

    subgraph "Storage & State"
        FileSystem[File System]
        ConfigStore[Config Store]
        SessionStore[Session State]
        LogStore[Logs]
    end

    CLI --> Router
    Web --> Router
    Desktop --> Router

    Router --> SessionMgr
    SessionMgr --> AgentSys
    AgentSys --> ToolRegistry

    ToolRegistry --> ProviderMgr
    ToolRegistry --> MCPClient
    ToolRegistry --> LSPClient
    ToolRegistry --> GitClient

    ProviderMgr --> LLMs
    MCPClient --> MCPServers
    LSPClient --> LSPServers
    GitClient --> GitHub

    SessionMgr --> FileSystem
    SessionMgr --> ConfigStore
    SessionMgr --> SessionStore
    SessionMgr --> LogStore

    style CLI fill:#e1f5ff
    style Web fill:#e1f5ff
    style Desktop fill:#e1f5ff
    style SessionMgr fill:#fff4e1
    style AgentSys fill:#fff4e1
    style ToolRegistry fill:#fff4e1
```

---

## Package Structure

```mermaid
graph LR
    subgraph "Monorepo Root"
        Root[opencode/]
    end

    subgraph "Core Packages"
        OpenCode[opencode<br/>CLI Application]
        App[app<br/>Shared UI Components]
        UI[ui<br/>Design System]
        Util[util<br/>Utilities]
        Plugin[plugin<br/>Plugin System]
        SDK[sdk/js<br/>JavaScript SDK]
    end

    subgraph "Applications"
        Desktop[desktop<br/>Tauri Desktop App]
        Web[web<br/>Marketing Site]
    end

    subgraph "Console System"
        ConsoleApp[console/app<br/>Web Console UI]
        ConsoleCore[console/core<br/>Backend Services]
        ConsoleMail[console/mail<br/>Email Service]
        ConsoleResource[console/resource<br/>Resources]
        ConsoleFunction[console/function<br/>Serverless]
    end

    subgraph "Enterprise & Extensions"
        Enterprise[enterprise<br/>Enterprise Features]
        Slack[slack<br/>Slack Integration]
        Extensions[extensions<br/>Browser Extensions]
    end

    Root --> OpenCode
    Root --> App
    Root --> UI
    Root --> Util
    Root --> Plugin
    Root --> SDK
    Root --> Desktop
    Root --> Web
    Root --> ConsoleApp
    Root --> ConsoleCore
    Root --> ConsoleMail
    Root --> ConsoleResource
    Root --> ConsoleFunction
    Root --> Enterprise
    Root --> Slack
    Root --> Extensions

    Desktop -.uses.-> App
    ConsoleApp -.uses.-> App
    App -.uses.-> UI
    OpenCode -.uses.-> Util
    OpenCode -.uses.-> Plugin
    OpenCode -.uses.-> SDK

    style OpenCode fill:#ff6b6b
    style App fill:#4ecdc4
    style Desktop fill:#ffe66d
    style ConsoleApp fill:#ffe66d
    style Web fill:#ffe66d
```

### Package Dependencies

```mermaid
graph TD
    OpenCode[opencode<br/>Main CLI]
    App[app<br/>Shared Components]
    UI[ui<br/>Design System]
    Util[util]
    Plugin[plugin]
    SDK[sdk]
    Script[script]
    Desktop[desktop]
    ConsoleApp[console/app]

    OpenCode --> Util
    OpenCode --> Plugin
    OpenCode --> SDK
    OpenCode --> Script

    Desktop --> App
    ConsoleApp --> App

    App --> UI
    App --> Util

    style OpenCode fill:#ff6b6b,color:#fff
    style App fill:#4ecdc4
    style Desktop fill:#95e1d3
    style ConsoleApp fill:#95e1d3
```

---

## Core Systems

### 1. CLI Command Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI as CLI Entry<br/>(index.ts)
    participant Yargs as Command Parser<br/>(Yargs)
    participant Cmd as Command Handler<br/>(cli/cmd/*)
    participant Session as Session Manager
    participant Agent as Agent System
    participant LLM as LLM Provider

    User->>CLI: opencode run "task"
    CLI->>Yargs: Parse arguments
    Yargs->>Cmd: Route to command

    Cmd->>Cmd: Load config
    Cmd->>Cmd: Authenticate
    Cmd->>Session: Create/resume session

    Session->>Agent: Initialize agent
    Agent->>Agent: Load permissions
    Agent->>Session: Ready

    Session->>LLM: Stream request
    LLM-->>Session: Stream response

    loop Tool Execution
        Session->>Agent: Execute tool
        Agent-->>Session: Tool result
        Session->>LLM: Continue with result
        LLM-->>Session: Next response
    end

    Session-->>User: Display output
```

### 2. Session and Agent System

```mermaid
graph TB
    subgraph "Session Layer packages/opencode/src/session/"
        SessionIndex[index.ts<br/>Session Orchestration]
        Prompt[prompt.ts<br/>Prompt Building]
        Processor[processor.ts<br/>Message Processing]
        LLMComm[llm.ts<br/>LLM Communication]
        Compaction[compaction.ts<br/>Context Compaction]
    end

    subgraph "Agent System packages/opencode/src/agent/"
        AgentConfig[agent.ts<br/>Agent Configuration]
        Permissions[Permission System]
        BuiltInAgents[Built-in Agents<br/>build, plan]
        CustomAgents[Custom Agents]
    end

    subgraph "Tool Execution"
        ToolRegistry[Tool Registry]
        CodeTools[Code Tools<br/>edit, read, write]
        ExecTools[Execution Tools<br/>bash, batch]
        SearchTools[Search Tools<br/>grep, glob, websearch]
        DevTools[Dev Tools<br/>task, skill, todo]
    end

    SessionIndex --> Prompt
    SessionIndex --> Processor
    Processor --> LLMComm
    Processor --> Compaction

    SessionIndex --> AgentConfig
    AgentConfig --> Permissions
    AgentConfig --> BuiltInAgents
    AgentConfig --> CustomAgents

    Processor --> ToolRegistry
    ToolRegistry --> CodeTools
    ToolRegistry --> ExecTools
    ToolRegistry --> SearchTools
    ToolRegistry --> DevTools

    Permissions -.controls.-> ToolRegistry

    style SessionIndex fill:#ff6b6b,color:#fff
    style AgentConfig fill:#4ecdc4
    style ToolRegistry fill:#ffe66d
```

### 3. Tool System Architecture

```mermaid
graph TB
    subgraph "Tool Interface"
        ToolDef[Tool Definition<br/>.txt description]
        ToolImpl[Tool Implementation<br/>.ts code]
        ToolSchema[Tool Schema<br/>Zod validation]
    end

    subgraph "Code Manipulation Tools packages/opencode/src/tool/"
        Read[read.ts<br/>Read files]
        Write[write.ts<br/>Write files]
        Edit[edit.ts<br/>Edit existing files]
        MultiEdit[multiedit.ts<br/>Batch edits]
        Patch[patch.ts<br/>Apply patches]
        Glob[glob.ts<br/>File patterns]
        Grep[grep.ts<br/>Content search]
    end

    subgraph "Execution Tools"
        Bash[bash.ts<br/>Shell commands]
        Batch[batch.ts<br/>Batch operations]
    end

    subgraph "Search & Analysis"
        CodeSearch[codesearch.ts<br/>Code search]
        WebSearch[websearch.ts<br/>Web search]
        WebFetch[webfetch.ts<br/>Fetch web content]
        LSP[lsp.ts<br/>Language Server]
    end

    subgraph "Development Tools"
        Task[task.ts<br/>Spawn sub-agents]
        Skill[skill.ts<br/>Execute skills]
        Todo[todo.ts<br/>Task management]
        TodoRead[todoread.ts]
        TodoWrite[todowrite.ts]
    end

    subgraph "Integration Tools"
        MCP[MCP Tools<br/>External integrations]
        Git[Git operations]
        GitHub[GitHub API]
    end

    ToolDef --> ToolImpl
    ToolImpl --> ToolSchema

    style Read fill:#e1f5ff
    style Write fill:#e1f5ff
    style Edit fill:#e1f5ff
    style Bash fill:#ffe1e1
    style Task fill:#fff4e1
    style MCP fill:#e1ffe1
```

### 4. Provider System

```mermaid
graph TB
    subgraph "Provider Abstraction packages/opencode/src/provider/"
        ProviderInterface[provider.ts<br/>Unified Interface]
        Auth[auth.ts<br/>Authentication]
        Models[models.ts<br/>Model Metadata]
        Transform[transform.ts<br/>I/O Transformation]
    end

    subgraph "Supported Providers"
        Anthropic[Anthropic<br/>Claude]
        OpenAI[OpenAI<br/>GPT-4, GPT-3.5]
        Google[Google<br/>Gemini]
        Vertex[Google Vertex<br/>Enterprise]
        Azure[Azure OpenAI]
        Bedrock[Amazon Bedrock]
        Groq[Groq]
        Mistral[Mistral]
        Cohere[Cohere]
        Cerebras[Cerebras]
        DeepInfra[DeepInfra]
        TogetherAI[Together AI]
        Perplexity[Perplexity]
        XAI[xAI Grok]
        OpenRouter[OpenRouter<br/>Multi-provider]
    end

    subgraph "AI SDK Vercel"
        AISDKCore[AI SDK Core<br/>Streaming, Tools]
    end

    ProviderInterface --> Auth
    ProviderInterface --> Models
    ProviderInterface --> Transform

    ProviderInterface --> AISDKCore

    AISDKCore --> Anthropic
    AISDKCore --> OpenAI
    AISDKCore --> Google
    AISDKCore --> Vertex
    AISDKCore --> Azure
    AISDKCore --> Bedrock
    AISDKCore --> Groq
    AISDKCore --> Mistral
    AISDKCore --> Cohere
    AISDKCore --> Cerebras
    AISDKCore --> DeepInfra
    AISDKCore --> TogetherAI
    AISDKCore --> Perplexity
    AISDKCore --> XAI
    AISDKCore --> OpenRouter

    style ProviderInterface fill:#ff6b6b,color:#fff
    style AISDKCore fill:#4ecdc4
    style Anthropic fill:#e1f5ff
    style OpenAI fill:#e1f5ff
    style Google fill:#e1f5ff
```

### 5. MCP (Model Context Protocol) Integration

```mermaid
graph TB
    subgraph "MCP System packages/opencode/src/mcp/"
        MCPIndex[index.ts<br/>MCP Client]
        MCPAuth[auth.ts<br/>OAuth Flow]
        MCPOAuth[oauth-provider.ts<br/>Provider Implementation]
    end

    subgraph "MCP Features"
        ToolConversion[Tool Conversion<br/>MCP → AI SDK]
        Notifications[Notification Handler<br/>Tool list changes]
        StatusMgr[Status Manager<br/>Connection states]
    end

    subgraph "MCP Server States"
        Connected[Connected<br/>Active]
        Disabled[Disabled<br/>User disabled]
        Failed[Failed<br/>Error state]
        NeedsAuth[Needs Auth<br/>OAuth required]
        NeedsReg[Needs Registration<br/>Client setup]
    end

    subgraph "External MCP Servers"
        FileSystem[Filesystem Server]
        Database[Database Server]
        API[API Server]
        Custom[Custom Servers]
    end

    MCPIndex --> MCPAuth
    MCPIndex --> MCPOAuth
    MCPIndex --> ToolConversion
    MCPIndex --> Notifications
    MCPIndex --> StatusMgr

    StatusMgr --> Connected
    StatusMgr --> Disabled
    StatusMgr --> Failed
    StatusMgr --> NeedsAuth
    StatusMgr --> NeedsReg

    MCPIndex -.connects to.-> FileSystem
    MCPIndex -.connects to.-> Database
    MCPIndex -.connects to.-> API
    MCPIndex -.connects to.-> Custom

    style MCPIndex fill:#ff6b6b,color:#fff
    style ToolConversion fill:#4ecdc4
    style Connected fill:#90ee90
    style Failed fill:#ff6b6b,color:#fff
```

### 6. LSP (Language Server Protocol) Integration

```mermaid
graph TB
    subgraph "LSP System packages/opencode/src/lsp/"
        LSPIndex[index.ts<br/>LSP Coordinator]
        LSPServer[server.ts<br/>LSP Server<br/>57KB implementation]
        LSPClient[client.ts<br/>LSP Client]
    end

    subgraph "LSP Features"
        Definitions[Go to Definition]
        References[Find References]
        Hover[Hover Information]
        Completion[Code Completion]
        Diagnostics[Diagnostics/Errors]
        Workspace[Workspace Support]
    end

    subgraph "Language Servers"
        TSServer[TypeScript<br/>tsserver]
        PyLSP[Python<br/>pylsp]
        RustAnalyzer[Rust<br/>rust-analyzer]
        GoLSP[Go<br/>gopls]
        OtherLSP[Other LSPs]
    end

    LSPIndex --> LSPServer
    LSPIndex --> LSPClient

    LSPServer --> Definitions
    LSPServer --> References
    LSPServer --> Hover
    LSPServer --> Completion
    LSPServer --> Diagnostics
    LSPServer --> Workspace

    LSPClient -.connects to.-> TSServer
    LSPClient -.connects to.-> PyLSP
    LSPClient -.connects to.-> RustAnalyzer
    LSPClient -.connects to.-> GoLSP
    LSPClient -.connects to.-> OtherLSP

    style LSPServer fill:#ff6b6b,color:#fff
    style LSPClient fill:#4ecdc4
```

---

## Data Flow

### Complete Request-Response Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI
    participant Config
    participant Session
    participant Agent
    participant Tool
    participant Provider
    participant LLM
    participant FS as File System

    User->>CLI: opencode run "Add feature X"

    CLI->>Config: Load configuration
    Config-->>CLI: Merged config

    CLI->>Session: Create session
    Session->>Agent: Initialize with permissions
    Agent-->>Session: Ready

    Session->>Provider: Select provider/model
    Provider-->>Session: Provider ready

    Session->>LLM: Stream: "Add feature X"
    LLM-->>Session: "I'll create file Y"
    Session-->>User: Display response

    LLM->>Session: Tool call: write_file
    Session->>Agent: Check permission
    Agent-->>Session: Permission granted

    Session->>Tool: Execute write_file
    Tool->>FS: Write file
    FS-->>Tool: Success
    Tool-->>Session: File written

    Session->>LLM: Continue with result
    LLM-->>Session: "File created. Now..."
    Session-->>User: Display response

    LLM->>Session: Tool call: bash
    Session->>Agent: Check permission
    Agent-->>Session: Permission granted

    Session->>Tool: Execute bash
    Tool-->>Session: Command output

    Session->>LLM: Continue with result
    LLM-->>Session: "Task complete!"
    Session-->>User: Display final response
```

### Configuration Loading Flow

```mermaid
graph TB
    Start[Start Application] --> EnvVars[1. Environment Variables]
    EnvVars --> Flags[2. Command-line Flags]
    Flags --> Global[3. Global Config<br/>~/.opencode/]
    Global --> Project[4. Project Config<br/>.opencode/]
    Project --> Repo[5. Repository Config<br/>opencode.json]
    Repo --> WellKnown[6. Well-Known Endpoint<br/>.well-known/opencode]
    WellKnown --> Merge[Merge All Configs]
    Merge --> Final[Final Configuration]

    Final --> AgentConfig[Agent Configuration]
    Final --> ProviderConfig[Provider Settings]
    Final --> ToolConfig[Tool Enablement]
    Final --> PermConfig[Permissions]
    Final --> PluginConfig[Plugin Settings]

    style Start fill:#90ee90
    style Final fill:#ff6b6b,color:#fff
    style Merge fill:#4ecdc4
```

### Tool Execution Permission Flow

```mermaid
flowchart TD
    Start[Tool Call Requested] --> CheckAgent{Agent has<br/>permission?}

    CheckAgent -->|No| Deny[Deny Execution]
    CheckAgent -->|Yes| CheckConfig{Config allows<br/>tool?}

    CheckConfig -->|No| Deny
    CheckConfig -->|Yes| CheckContext{Execution<br/>context safe?}

    CheckContext -->|No| Deny
    CheckContext -->|Yes| CheckSandbox{Sandbox<br/>required?}

    CheckSandbox -->|Yes| Sandbox[Execute in Sandbox]
    CheckSandbox -->|No| Direct[Execute Directly]

    Sandbox --> Monitor[Monitor Execution]
    Direct --> Monitor

    Monitor --> Success{Success?}

    Success -->|Yes| Return[Return Result]
    Success -->|No| Error[Return Error]

    Deny --> Error

    Return --> End[End]
    Error --> End

    style Start fill:#90ee90
    style Deny fill:#ff6b6b,color:#fff
    style Return fill:#90ee90
    style Error fill:#ff6b6b,color:#fff
```

---

## Feature Implementation

### Feature: File Editing

```mermaid
graph TB
    subgraph "Edit Tool Implementation"
        EditTool[edit.ts<br/>Main implementation]
        ReadFirst[Read file first<br/>Required]
        FindString[Find exact string<br/>old_string]
        ReplaceString[Replace with<br/>new_string]
        ReplaceAll[replace_all option<br/>Multiple occurrences]
    end

    subgraph "Supporting Tools"
        Read[read.ts<br/>Read file contents]
        MultiEdit[multiedit.ts<br/>Batch edits]
        Patch[patch.ts<br/>Apply diffs]
    end

    subgraph "Validation"
        CheckRead[Must read first]
        CheckUnique[String must be unique]
        CheckDifferent[old ≠ new]
        PreserveIndent[Preserve indentation]
    end

    EditTool --> ReadFirst
    ReadFirst --> FindString
    FindString --> ReplaceString
    ReplaceString --> ReplaceAll

    EditTool -.uses.-> Read
    EditTool -.alternative.-> MultiEdit
    EditTool -.alternative.-> Patch

    EditTool --> CheckRead
    EditTool --> CheckUnique
    EditTool --> CheckDifferent
    EditTool --> PreserveIndent

    style EditTool fill:#ff6b6b,color:#fff
    style CheckRead fill:#ffe66d
    style CheckUnique fill:#ffe66d
```

### Feature: Code Search

```mermaid
graph TB
    subgraph "Search Tools"
        Glob[glob.ts<br/>File pattern matching]
        Grep[grep.ts<br/>Content search<br/>ripgrep]
        CodeSearch[codesearch.ts<br/>Advanced search]
    end

    subgraph "Search Capabilities"
        FilePattern[File Patterns<br/>**/*.ts, src/**/*.js]
        Regex[Regex Patterns<br/>function\\s+\\w+]
        CaseSensitive[Case Sensitivity<br/>-i flag]
        Context[Context Lines<br/>-A, -B, -C flags]
        OutputModes[Output Modes<br/>content, files, count]
    end

    subgraph "Advanced Features"
        GlobFilter[Glob filtering<br/>--glob *.js]
        TypeFilter[Type filtering<br/>--type js]
        Multiline[Multiline matching<br/>--multiline]
        HeadLimit[Result limiting<br/>head_limit]
    end

    Glob --> FilePattern
    Grep --> Regex
    Grep --> CaseSensitive
    Grep --> Context
    Grep --> OutputModes

    CodeSearch --> GlobFilter
    CodeSearch --> TypeFilter
    CodeSearch --> Multiline
    CodeSearch --> HeadLimit

    style Glob fill:#4ecdc4
    style Grep fill:#4ecdc4
    style CodeSearch fill:#ff6b6b,color:#fff
```

### Feature: Task Management (Subagents)

```mermaid
graph TB
    subgraph "Task Tool packages/opencode/src/tool/task.ts"
        TaskDef[Task Definition]
        Subagents[Specialized Subagents]
        Prompt[Task Prompt]
        Model[Model Selection]
    end

    subgraph "Built-in Subagents"
        General[general-purpose<br/>Complex multi-step tasks]
        Explore[Explore<br/>Codebase exploration]
        Plan[Plan<br/>Implementation planning]
        StatusLine[statusline-setup<br/>Config setup]
        CodeGuide[claude-code-guide<br/>Documentation]
    end

    subgraph "Execution"
        Spawn[Spawn subagent]
        Context[Access to context]
        Tools[Access to tools]
        Report[Return report]
    end

    TaskDef --> Prompt
    TaskDef --> Model
    TaskDef --> Subagents

    Subagents --> General
    Subagents --> Explore
    Subagents --> Plan
    Subagents --> StatusLine
    Subagents --> CodeGuide

    General --> Spawn
    Explore --> Spawn
    Plan --> Spawn

    Spawn --> Context
    Spawn --> Tools
    Tools --> Report

    style TaskDef fill:#ff6b6b,color:#fff
    style General fill:#4ecdc4
    style Explore fill:#4ecdc4
```

### Feature: GitHub Integration

```mermaid
graph TB
    subgraph "GitHub Commands packages/opencode/src/cli/cmd/"
        GitHubCmd[github.ts<br/>GitHub integration]
        PRCmd[pr.ts<br/>PR management]
    end

    subgraph "Operations"
        CreatePR[Create Pull Request<br/>gh pr create]
        FetchPR[Fetch PR<br/>gh pr view]
        ListPR[List PRs<br/>gh pr list]
        CheckStatus[Check CI status<br/>gh pr checks]
        Comments[PR Comments<br/>gh api]
    end

    subgraph "Git Operations"
        Branch[Branch management]
        Commit[Commit creation]
        Push[Push to remote]
        Diff[View changes]
    end

    subgraph "Integration"
        OctokitREST[@octokit/rest<br/>REST API]
        OctokitGraphQL[@octokit/graphql<br/>GraphQL API]
        CLI[gh CLI tool]
    end

    GitHubCmd --> CreatePR
    GitHubCmd --> FetchPR
    GitHubCmd --> ListPR
    PRCmd --> CheckStatus
    PRCmd --> Comments

    CreatePR --> Branch
    CreatePR --> Commit
    CreatePR --> Push
    CreatePR --> Diff

    GitHubCmd --> OctokitREST
    GitHubCmd --> OctokitGraphQL
    GitHubCmd --> CLI

    style GitHubCmd fill:#ff6b6b,color:#fff
    style CreatePR fill:#4ecdc4
```

---

## Build and Deployment

### Build Process

```mermaid
graph TB
    subgraph "Source Code"
        TS[TypeScript Source<br/>src/**/*.ts]
        Config[Config Files<br/>tsconfig.json]
    end

    subgraph "Build Tools"
        Turbo[Turbo<br/>Task orchestration]
        Bun[Bun<br/>Build & bundle]
        Vite[Vite<br/>Web apps]
        Tauri[Tauri<br/>Desktop]
    end

    subgraph "Build Steps"
        TypeCheck[Type checking<br/>tsc --noEmit]
        Compile[Compilation<br/>esbuild]
        Bundle[Bundling]
        Optimize[Optimization]
    end

    subgraph "Outputs"
        CLIBin[CLI Binaries<br/>Linux, macOS, Windows]
        DesktopApp[Desktop Apps<br/>DMG, EXE, DEB, RPM]
        WebApp[Web Apps<br/>Static files]
        NPMPkg[NPM Packages]
    end

    TS --> Turbo
    Config --> Turbo

    Turbo --> TypeCheck
    TypeCheck --> Compile
    Compile --> Bundle
    Bundle --> Optimize

    Turbo --> Bun
    Turbo --> Vite
    Turbo --> Tauri

    Bun --> CLIBin
    Tauri --> DesktopApp
    Vite --> WebApp
    Bun --> NPMPkg

    style Turbo fill:#ff6b6b,color:#fff
    style CLIBin fill:#90ee90
    style DesktopApp fill:#90ee90
```

### Deployment Architecture

```mermaid
graph TB
    subgraph "Distribution Channels"
        NPM[npm/bun/yarn/pnpm<br/>Package managers]
        Homebrew[Homebrew<br/>macOS/Linux]
        Scoop[Scoop<br/>Windows]
        Choco[Chocolatey<br/>Windows]
        Direct[Direct Download<br/>GitHub Releases]
        Nix[Nix<br/>Package manager]
    end

    subgraph "Platforms"
        MacOS[macOS<br/>Apple Silicon + Intel]
        Linux[Linux<br/>x64, arm64, musl]
        Windows[Windows<br/>x64]
    end

    subgraph "Cloud Infrastructure SST"
        CloudflareWorkers[Cloudflare Workers<br/>Serverless functions]
        PlanetScale[PlanetScale<br/>Database]
        S3[AWS S3<br/>Storage]
    end

    NPM --> MacOS
    NPM --> Linux
    NPM --> Windows

    Homebrew --> MacOS
    Homebrew --> Linux

    Scoop --> Windows
    Choco --> Windows

    Direct --> MacOS
    Direct --> Linux
    Direct --> Windows

    Nix --> MacOS
    Nix --> Linux

    MacOS -.uses cloud.-> CloudflareWorkers
    Linux -.uses cloud.-> CloudflareWorkers
    Windows -.uses cloud.-> CloudflareWorkers

    CloudflareWorkers --> PlanetScale
    CloudflareWorkers --> S3

    style CloudflareWorkers fill:#ff6b6b,color:#fff
```

---

## How to Use in Your Chatbot Project

### Integration Strategies

```mermaid
graph TB
    subgraph "Your Chatbot Project"
        YourBot[Your Chatbot]
    end

    subgraph "OpenCode Integration Options"
        Option1[Option 1:<br/>Use as Library]
        Option2[Option 2:<br/>Use CLI as Tool]
        Option3[Option 3:<br/>Fork & Customize]
        Option4[Option 4:<br/>Learn Architecture]
    end

    subgraph "Option 1: Library Integration"
        SDK[@opencode-ai/sdk<br/>JavaScript SDK]
        Provider[Provider System<br/>Multi-LLM support]
        Tools[Tool Implementations<br/>Copy tool patterns]
    end

    subgraph "Option 2: CLI Tool"
        CLITool[opencode CLI<br/>Subprocess]
        API[Spawn & communicate<br/>via stdio]
    end

    subgraph "Option 3: Fork"
        ForkRepo[Fork repository]
        Customize[Customize for needs]
        Maintain[Maintain fork]
    end

    subgraph "Option 4: Learn"
        StudyAgent[Study agent system<br/>agent/agent.ts]
        StudySession[Study session mgmt<br/>session/]
        StudyTools[Study tool system<br/>tool/]
        StudyProvider[Study providers<br/>provider/]
    end

    YourBot --> Option1
    YourBot --> Option2
    YourBot --> Option3
    YourBot --> Option4

    Option1 --> SDK
    Option1 --> Provider
    Option1 --> Tools

    Option2 --> CLITool
    CLITool --> API

    Option3 --> ForkRepo
    ForkRepo --> Customize
    Customize --> Maintain

    Option4 --> StudyAgent
    Option4 --> StudySession
    Option4 --> StudyTools
    Option4 --> StudyProvider

    style YourBot fill:#90ee90
    style Option1 fill:#4ecdc4
    style Option2 fill:#4ecdc4
    style Option3 fill:#ffe66d
    style Option4 fill:#ff6b6b,color:#fff
```

### Key Concepts to Borrow

1. **Agent Permission System** (`packages/opencode/src/agent/agent.ts`)
   - Define agents with specific capabilities
   - Control what each agent can do (edit files, run bash, etc.)
   - Build vs Plan modes

2. **Tool System** (`packages/opencode/src/tool/`)
   - Modular tool architecture
   - Tool descriptions in `.txt` files
   - Tool implementations in `.ts` files
   - Zod schema validation
   - Permission checks before execution

3. **Provider Abstraction** (`packages/opencode/src/provider/`)
   - Support multiple LLM providers
   - Unified interface using AI SDK
   - Easy provider switching
   - Model capability detection

4. **Session Management** (`packages/opencode/src/session/`)
   - Context management and compaction
   - Message history handling
   - Streaming responses
   - State persistence

5. **Configuration System** (`packages/opencode/src/config/`)
   - Hierarchical configuration merging
   - Environment-based overrides
   - Plugin support
   - Well-known endpoints

### Example: Simple Tool Implementation

```typescript
// Example based on OpenCode's tool pattern
import { z } from 'zod'

// 1. Define tool schema
const MyToolSchema = z.object({
  input: z.string().describe('Input to process'),
  options: z.object({
    verbose: z.boolean().optional()
  }).optional()
})

// 2. Implement tool function
async function myTool(params: z.infer<typeof MyToolSchema>) {
  // Tool logic here
  const result = processInput(params.input)

  return {
    success: true,
    data: result
  }
}

// 3. Register with AI SDK format
const tool = {
  description: 'My custom tool description',
  parameters: MyToolSchema,
  execute: myTool
}
```

### Example: Provider Integration Pattern

```typescript
// Example based on OpenCode's provider system
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'

// Multi-provider support like OpenCode
const providers = {
  anthropic: createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  }),
  openai: createOpenAI({
    apiKey: process.env.OPENAI_API_KEY
  })
}

// Select provider at runtime
const provider = providers[config.provider]
const model = provider(config.model)
```

---

## File Reference Guide

### Essential Files to Study

| File Path | Purpose | Lines | Complexity |
|-----------|---------|-------|------------|
| `packages/opencode/src/index.ts` | CLI entry point | ~400 | Medium |
| `packages/opencode/src/agent/agent.ts` | Agent system core | ~300 | High |
| `packages/opencode/src/session/index.ts` | Session orchestration | ~800 | High |
| `packages/opencode/src/session/llm.ts` | LLM communication | ~500 | High |
| `packages/opencode/src/provider/provider.ts` | Provider abstraction | ~600 | High |
| `packages/opencode/src/tool/*.ts` | Individual tools | ~100-500 each | Medium |
| `packages/opencode/src/mcp/index.ts` | MCP integration | ~400 | High |
| `packages/opencode/src/lsp/server.ts` | LSP server | ~2000 | Very High |
| `packages/opencode/src/config/config.ts` | Configuration system | ~400 | Medium |
| `packages/app/src/pages/session.tsx` | UI session page | ~600 | Medium |

### Directory Map

```
packages/opencode/src/
├── index.ts                    # Entry point
├── agent/                      # Agent system
│   └── agent.ts               # Agent configuration & permissions
├── cli/                       # CLI commands
│   └── cmd/                   # Command implementations
│       ├── run.ts             # Main run command
│       ├── auth.ts            # Authentication
│       ├── mcp.ts             # MCP management
│       └── github.ts          # GitHub integration
├── session/                   # Session management
│   ├── index.ts               # Main orchestration
│   ├── prompt.ts              # Prompt building
│   ├── llm.ts                 # LLM communication
│   ├── processor.ts           # Message processing
│   └── compaction.ts          # Context compaction
├── provider/                  # Provider system
│   ├── provider.ts            # Unified interface
│   ├── auth.ts                # Authentication
│   └── models.ts              # Model metadata
├── tool/                      # Tool implementations
│   ├── edit.ts                # File editing
│   ├── read.ts                # File reading
│   ├── write.ts               # File writing
│   ├── bash.ts                # Shell execution
│   ├── glob.ts                # File globbing
│   ├── grep.ts                # Content search
│   ├── task.ts                # Subagents
│   ├── websearch.ts           # Web search
│   └── todo*.ts               # Task management
├── mcp/                       # Model Context Protocol
│   ├── index.ts               # MCP client
│   └── auth.ts                # OAuth flow
├── lsp/                       # Language Server Protocol
│   ├── index.ts               # Coordinator
│   ├── server.ts              # LSP server
│   └── client.ts              # LSP client
├── config/                    # Configuration
│   └── config.ts              # Config loading & merging
├── project/                   # Project management
├── storage/                   # Storage utilities
└── util/                      # Utilities
```

---

## Summary

OpenCode is a sophisticated, production-ready AI coding assistant built with:

- **Modern Tech Stack**: TypeScript, Bun, SolidJS, Tauri
- **Multi-Platform**: CLI, Web, Desktop
- **Provider-Agnostic**: 15+ LLM providers supported
- **Extensible**: MCP, LSP, Plugin system
- **Enterprise-Ready**: Authentication, billing, team collaboration

### Key Architectural Patterns

1. **Modular Tool System**: Each capability is a separate tool with schema validation
2. **Permission-Based Agent System**: Fine-grained control over agent capabilities
3. **Provider Abstraction**: Easy switching between LLM providers
4. **Session-Based Architecture**: Stateful conversations with context management
5. **Monorepo Structure**: Organized packages for different concerns

### For Your Chatbot Project

- **Borrow**: Tool patterns, provider abstraction, agent permissions
- **Learn**: Session management, context compaction, streaming
- **Integrate**: Use SDK or CLI as subprocess
- **Customize**: Fork and adapt to your specific needs

This guide provides a comprehensive understanding of OpenCode's architecture. Study the referenced files to dive deeper into specific areas of interest!
