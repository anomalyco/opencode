# OpenCode 架构图文档

本文档通过流程图、时序图和关系图全面展示 OpenCode Agent Loop 的架构设计。

## 目录

1. [整体架构概览](#1-整体架构概览)
2. [核心模块关系图](#2-核心模块关系图)
3. [Agent Loop 主流程图](#3-agent-loop-主流程图)
4. [消息处理时序图](#4-消息处理时序图)
5. [工具执行流程图](#5-工具执行流程图)
6. [权限系统流程图](#6-权限系统流程图)
7. [消息与部件类型关系图](#7-消息与部件类型关系图)
8. [Provider 与 Model 架构图](#8-provider-与-model-架构图)
9. [SubAgent (Task) 执行流程图](#9-subagent-task-执行流程图)
10. [数据流总览图](#10-数据流总览图)
11. [Plugin 系统架构图](#11-plugin-系统架构图) ⭐ NEW
12. [Tool 异常处理流程图](#12-tool-异常处理流程图) ⭐ NEW
13. [LLM 重试机制流程图](#13-llm-重试机制流程图) ⭐ NEW
14. [Doom Loop 检测机制](#14-doom-loop-检测机制) ⭐ NEW
15. [关键代码文件索引](#15-关键代码文件索引)
16. [架构设计原则](#16-架构设计原则)

---

## 1. 整体架构概览

```mermaid
graph TB
    subgraph "入口层 Entry Layer"
        CLI["CLI 命令行<br/>index.ts"]
        Web["Web Server<br/>serve.ts"]
        ACP["ACP Protocol<br/>acp/agent.ts"]
        TUI["Terminal UI<br/>tui.ts"]
    end

    subgraph "会话层 Session Layer"
        SessionMgr["Session Manager<br/>session/index.ts"]
        Prompt["Prompt Handler<br/>session/prompt.ts"]
        Processor["Stream Processor<br/>session/processor.ts"]
    end

    subgraph "Agent 层 Agent Layer"
        AgentConfig["Agent Configuration<br/>agent/agent.ts"]
        AgentPrompt["Agent Prompts<br/>agent/prompt/"]
        SubAgent["SubAgent System<br/>task tool"]
    end

    subgraph "LLM 层 LLM Layer"
        LLM["LLM Streaming<br/>session/llm.ts"]
        Provider["Provider Manager<br/>provider/provider.ts"]
        SDK["AI SDK Wrapper<br/>provider/sdk/"]
    end

    subgraph "工具层 Tool Layer"
        Registry["Tool Registry<br/>tool/registry.ts"]
        BuiltIn["Built-in Tools<br/>bash, read, write, edit..."]
        Custom["Custom Tools<br/>.opencode/tool/"]
        MCP["MCP Tools<br/>mcp/"]
    end

    subgraph "权限层 Permission Layer"
        PermNext["Permission System<br/>permission/next.ts"]
        Ruleset["Permission Ruleset"]
    end

    subgraph "存储层 Storage Layer"
        Storage["Storage Engine<br/>storage/"]
        Messages["Messages Store"]
        Sessions["Sessions Store"]
        Snapshots["Snapshots Store"]
    end

    subgraph "事件层 Event Layer"
        Bus["Event Bus<br/>bus/"]
        Subscribers["Event Subscribers"]
    end

    CLI --> SessionMgr
    Web --> SessionMgr
    ACP --> SessionMgr
    TUI --> SessionMgr

    SessionMgr --> Prompt
    Prompt --> Processor
    Prompt --> AgentConfig

    AgentConfig --> AgentPrompt
    AgentConfig --> SubAgent

    Processor --> LLM
    Processor --> Registry

    LLM --> Provider
    Provider --> SDK

    Registry --> BuiltIn
    Registry --> Custom
    Registry --> MCP

    Registry --> PermNext
    PermNext --> Ruleset

    Processor --> Storage
    SessionMgr --> Storage
    Storage --> Messages
    Storage --> Sessions
    Storage --> Snapshots

    Processor --> Bus
    SessionMgr --> Bus
    Bus --> Subscribers

    style Prompt fill:#e1f5fe
    style Processor fill:#e1f5fe
    style LLM fill:#fff3e0
    style Registry fill:#f3e5f5
    style PermNext fill:#ffebee
```

---

## 2. 核心模块关系图

```mermaid
graph LR
    subgraph "Core Modules"
        Session["Session<br/>会话管理"]
        Message["MessageV2<br/>消息模型"]
        Part["Part<br/>消息部件"]
        Tool["Tool<br/>工具接口"]
        Agent["Agent<br/>智能体"]
        Provider["Provider<br/>LLM提供商"]
    end

    subgraph "Support Modules"
        Storage["Storage<br/>持久化"]
        Bus["Bus<br/>事件总线"]
        Permission["Permission<br/>权限控制"]
        Plugin["Plugin<br/>插件系统"]
        Snapshot["Snapshot<br/>快照系统"]
    end

    Session -->|"包含"| Message
    Message -->|"包含"| Part
    Session -->|"使用"| Agent
    Session -->|"使用"| Provider

    Agent -->|"定义权限"| Permission
    Agent -->|"使用"| Tool

    Tool -->|"请求权限"| Permission
    Tool -->|"执行时触发"| Plugin

    Message -->|"存储到"| Storage
    Session -->|"存储到"| Storage

    Session -->|"发布事件"| Bus
    Message -->|"发布事件"| Bus

    Tool -->|"创建"| Snapshot
    Message -->|"包含"| Snapshot

    style Session fill:#bbdefb
    style Message fill:#c8e6c9
    style Tool fill:#fff9c4
    style Agent fill:#ffccbc
```

---

## 3. Agent Loop 主流程图

```mermaid
flowchart TB
    Start([开始]) --> CreateUser["创建用户消息<br/>MessageV2.User"]
    CreateUser --> SaveUser["保存用户消息到 Storage"]
    SaveUser --> LoopStart{{"进入 Loop 循环"}}

    LoopStart --> GetLast["获取最后的消息<br/>user/assistant"]
    GetLast --> CheckExit{"检查退出条件<br/>assistant 已完成?"}

    CheckExit -->|是| LoopEnd([返回最终消息])
    CheckExit -->|否| CreateAssistant["创建空的 Assistant 消息"]

    CreateAssistant --> ResolveTools["解析可用工具<br/>ToolRegistry.tools()"]
    ResolveTools --> GetSystem["获取系统提示词<br/>SessionSystem.resolve()"]

    GetSystem --> CreateProcessor["创建 SessionProcessor"]
    CreateProcessor --> StreamLLM["调用 LLM.stream()<br/>流式获取响应"]

    StreamLLM --> Process["processor.process()<br/>处理流式响应"]

    Process --> HandleStream{"处理流事件"}

    HandleStream --> TextDelta["text-delta<br/>文本增量"]
    HandleStream --> ToolCall["tool-call<br/>工具调用"]
    HandleStream --> Reasoning["reasoning<br/>推理内容"]
    HandleStream --> StepFinish["step-finish<br/>步骤完成"]

    TextDelta --> UpdatePart["更新消息 Part"]
    ToolCall --> ExecuteTool["执行工具"]
    Reasoning --> UpdatePart
    StepFinish --> UpdatePart

    ExecuteTool --> ToolResult["获取工具结果"]
    ToolResult --> UpdatePart

    UpdatePart --> CheckResult{"检查处理结果"}

    CheckResult -->|continue| LoopStart
    CheckResult -->|stop| LoopEnd
    CheckResult -->|compact| Compact["创建压缩任务"]
    Compact --> LoopStart

    style LoopStart fill:#fff3e0
    style StreamLLM fill:#e3f2fd
    style Process fill:#e8f5e9
    style ExecuteTool fill:#fce4ec
```

---

## 4. 消息处理时序图

```mermaid
sequenceDiagram
    participant User as 用户
    participant CLI as CLI/Web
    participant Session as Session Manager
    participant Prompt as SessionPrompt
    participant Processor as SessionProcessor
    participant LLM as LLM.stream()
    participant Tool as Tool Registry
    participant Storage as Storage
    participant Bus as Event Bus

    User->>CLI: 输入消息
    CLI->>Session: Session.prompt(input)

    Session->>Session: 创建 UserMessage
    Session->>Storage: 保存 UserMessage
    Session->>Bus: 发布 Message.Updated

    Session->>Prompt: loop(sessionID)

    loop Agent Loop
        Prompt->>Prompt: 检查退出条件
        Prompt->>Session: 创建 AssistantMessage
        Prompt->>Tool: resolveTools()
        Tool-->>Prompt: 返回可用工具列表

        Prompt->>Processor: 创建 processor
        Prompt->>LLM: stream(messages, tools, system)

        LLM-->>Processor: 流式响应 (text-delta, tool-call...)

        loop 处理流事件
            Processor->>Processor: 解析事件类型

            alt 文本增量
                Processor->>Storage: 更新 TextPart
            else 工具调用
                Processor->>Tool: 执行工具
                Tool->>Tool: 权限检查
                Tool-->>Processor: 工具结果
                Processor->>Storage: 更新 ToolPart
            else 推理内容
                Processor->>Storage: 更新 ReasoningPart
            end

            Processor->>Bus: 发布 Part.Updated
        end

        Processor-->>Prompt: 返回状态 (continue/stop/compact)
    end

    Prompt->>Storage: 保存最终 AssistantMessage
    Prompt->>Bus: 发布 Message.Updated
    Prompt-->>Session: 返回 AssistantMessage
    Session-->>CLI: 返回响应
    CLI-->>User: 显示结果
```

---

## 5. 工具执行流程图

```mermaid
flowchart TB
    subgraph "工具注册 Tool Registration"
        RegStart([ToolRegistry.tools]) --> LoadBuiltin["加载内置工具<br/>bash, read, write, edit..."]
        LoadBuiltin --> LoadCustom["加载自定义工具<br/>.opencode/tool/*.ts"]
        LoadCustom --> LoadMCP["加载 MCP 工具"]
        LoadMCP --> FilterCaps["过滤 Provider 能力"]
        FilterCaps --> FilterPerm["过滤 Agent 权限"]
        FilterPerm --> ReturnTools["返回可用工具列表"]
    end

    subgraph "工具执行 Tool Execution"
        ToolCall([接收 tool-call 事件]) --> CreatePart["创建 ToolPart<br/>state: pending"]
        CreatePart --> InitTool["初始化工具<br/>Tool.init()"]

        InitTool --> ValidateArgs["验证参数<br/>Zod Schema"]
        ValidateArgs --> ValidResult{"验证结果"}

        ValidResult -->|失败| FormatError["格式化错误信息"]
        FormatError --> ErrorPart["更新 ToolPart<br/>state: error"]

        ValidResult -->|成功| CheckPerm["检查权限<br/>PermissionNext.ask()"]

        CheckPerm --> PermResult{"权限结果"}

        PermResult -->|deny| RejectPart["更新 ToolPart<br/>state: error<br/>RejectedError"]

        PermResult -->|ask| WaitUser["等待用户确认"]
        WaitUser --> UserDecision{"用户决定"}
        UserDecision -->|拒绝| RejectPart
        UserDecision -->|允许| RunTool

        PermResult -->|allow| RunTool["执行工具<br/>tool.execute()"]

        RunTool --> UpdateRunning["更新 ToolPart<br/>state: running"]
        UpdateRunning --> Execute["执行具体操作"]

        Execute --> HookBefore["Plugin Hook<br/>tool.execute.before"]
        HookBefore --> ActualExec["实际执行"]
        ActualExec --> HookAfter["Plugin Hook<br/>tool.execute.after"]

        HookAfter --> ExecResult{"执行结果"}

        ExecResult -->|成功| CompletePart["更新 ToolPart<br/>state: completed"]
        ExecResult -->|失败| ErrorPartExec["更新 ToolPart<br/>state: error"]

        CompletePart --> ReturnResult["返回工具结果<br/>给 LLM"]
        ErrorPartExec --> ReturnResult
    end

    style ToolCall fill:#fff3e0
    style CheckPerm fill:#ffebee
    style RunTool fill:#e8f5e9
    style ReturnResult fill:#e3f2fd
```

---

## 6. 权限系统流程图

```mermaid
flowchart TB
    subgraph "权限定义 Permission Definition"
        AgentDef["Agent 定义<br/>permission: Ruleset"]
        SessionDef["Session 级别<br/>permission: Ruleset"]

        Ruleset["Ruleset 规则集<br/>[{permission, action, pattern}]"]

        AgentDef --> Ruleset
        SessionDef --> Ruleset
    end

    subgraph "权限检查 Permission Check"
        ToolExec([工具执行请求]) --> AskPerm["PermissionNext.ask()"]

        AskPerm --> BuildReq["构建权限请求<br/>permission, patterns, metadata"]
        BuildReq --> EvalRules["评估规则集"]

        EvalRules --> MatchRule{"匹配规则"}

        MatchRule -->|无匹配| DefaultAsk["默认: ask"]
        MatchRule -->|匹配 allow| AllowResult["action: allow"]
        MatchRule -->|匹配 deny| DenyResult["action: deny"]
        MatchRule -->|匹配 ask| AskResult["action: ask"]

        DefaultAsk --> AskResult

        AllowResult --> Continue([继续执行])

        DenyResult --> Reject["抛出 RejectedError"]
        Reject --> BlockExec([阻止执行])

        AskResult --> PromptUser["提示用户确认"]
        PromptUser --> UserChoice{"用户选择"}

        UserChoice -->|允许| SaveAllow["保存允许规则"]
        SaveAllow --> Continue

        UserChoice -->|拒绝| SaveDeny["保存拒绝规则"]
        SaveDeny --> BlockExec

        UserChoice -->|始终允许| SaveAlways["保存永久规则"]
        SaveAlways --> Continue
    end

    subgraph "权限规则示例 Example Rules"
        Example1["bash: allow, pattern: *"]
        Example2["write: ask, pattern: src/**"]
        Example3["write: deny, pattern: node_modules/**"]
    end

    style AskPerm fill:#fff3e0
    style PromptUser fill:#e3f2fd
    style Continue fill:#e8f5e9
    style BlockExec fill:#ffebee
```

---

## 7. 消息与部件类型关系图

```mermaid
classDiagram
    class MessageV2 {
        <<interface>>
        +id: string
        +sessionID: string
        +time: TimeInfo
        +parts: Part[]
    }

    class UserMessage {
        +role: "user"
        +agent: string
        +model: ModelRef
        +tools?: Record
        +system?: string
        +variant?: string
    }

    class AssistantMessage {
        +role: "assistant"
        +parentID: string
        +agent: string
        +modelID: string
        +providerID: string
        +cost: number
        +tokens: TokenInfo
        +finish?: string
        +error?: Error
    }

    class Part {
        <<interface>>
        +id: string
        +messageID: string
        +sessionID: string
        +type: string
    }

    class TextPart {
        +type: "text"
        +text: string
    }

    class ReasoningPart {
        +type: "reasoning"
        +text: string
    }

    class ToolPart {
        +type: "tool"
        +tool: string
        +callID: string
        +state: ToolState
        +input?: object
        +output?: string
        +metadata?: object
    }

    class FilePart {
        +type: "file"
        +mime: string
        +url: string
    }

    class SnapshotPart {
        +type: "snapshot"
        +snapshot: string
    }

    class PatchPart {
        +type: "patch"
        +hash: string
        +files: string[]
    }

    class StepStartPart {
        +type: "step-start"
    }

    class StepFinishPart {
        +type: "step-finish"
        +reason: string
        +tokens: TokenInfo
        +cost: number
    }

    MessageV2 <|-- UserMessage
    MessageV2 <|-- AssistantMessage

    Part <|-- TextPart
    Part <|-- ReasoningPart
    Part <|-- ToolPart
    Part <|-- FilePart
    Part <|-- SnapshotPart
    Part <|-- PatchPart
    Part <|-- StepStartPart
    Part <|-- StepFinishPart

    MessageV2 "1" *-- "*" Part : contains
```

---

## 8. Provider 与 Model 架构图

```mermaid
flowchart TB
    subgraph "Provider Layer"
        ProviderMgr["Provider Manager<br/>provider/provider.ts"]

        subgraph "Providers"
            Anthropic["Anthropic<br/>Claude Models"]
            OpenAI["OpenAI<br/>GPT Models"]
            Google["Google<br/>Gemini Models"]
            AWS["AWS Bedrock"]
            Azure["Azure OpenAI"]
            Custom["Custom Provider"]
        end
    end

    subgraph "Model Configuration"
        ModelDef["Model Definition"]
        Capabilities["Capabilities<br/>temperature, reasoning,<br/>attachment, toolcall"]
        Limits["Limits<br/>context, output"]
        Cost["Cost<br/>input, output, cache"]
    end

    subgraph "SDK Integration"
        AISDK["Vercel AI SDK<br/>@ai-sdk/*"]

        subgraph "Provider SDKs"
            AnthropicSDK["@ai-sdk/anthropic"]
            OpenAISDK["@ai-sdk/openai"]
            GoogleSDK["@ai-sdk/google"]
        end
    end

    subgraph "LLM Streaming"
        LLMStream["LLM.stream()"]
        StreamText["streamText()"]

        Transform["Provider Transform<br/>转换参数和响应"]

        Middleware["Middleware<br/>提取 reasoning"]
    end

    ProviderMgr --> Anthropic
    ProviderMgr --> OpenAI
    ProviderMgr --> Google
    ProviderMgr --> AWS
    ProviderMgr --> Azure
    ProviderMgr --> Custom

    Anthropic --> ModelDef
    ModelDef --> Capabilities
    ModelDef --> Limits
    ModelDef --> Cost

    AISDK --> AnthropicSDK
    AISDK --> OpenAISDK
    AISDK --> GoogleSDK

    LLMStream --> Transform
    Transform --> StreamText
    StreamText --> AISDK
    StreamText --> Middleware

    style ProviderMgr fill:#e3f2fd
    style LLMStream fill:#e8f5e9
    style AISDK fill:#fff3e0
```

---

## 9. SubAgent (Task) 执行流程图

```mermaid
flowchart TB
    subgraph "主 Agent Main Agent"
        MainLoop["主 Agent Loop"]
        TaskTool["Task Tool 调用"]
    end

    subgraph "SubAgent 创建"
        CreateSub["创建子会话<br/>Session.create()"]
        LoadAgent["加载 Agent 配置<br/>Agent.fromName()"]
        SetupPerm["设置权限规则<br/>agent.permission"]
    end

    subgraph "SubAgent 执行"
        SubPrompt["SubAgent Prompt"]
        SubLoop["SubAgent Loop"]
        SubTools["SubAgent 工具集<br/>(受限)"]
        SubLLM["SubAgent LLM 调用"]
    end

    subgraph "结果返回"
        SubResult["SubAgent 结果"]
        ExtractOutput["提取输出"]
        ReturnMain["返回主 Agent"]
    end

    MainLoop --> TaskTool
    TaskTool --> CreateSub
    CreateSub --> LoadAgent
    LoadAgent --> SetupPerm

    SetupPerm --> SubPrompt
    SubPrompt --> SubLoop

    SubLoop --> SubTools
    SubLoop --> SubLLM
    SubLLM --> SubLoop

    SubLoop -->|完成| SubResult
    SubResult --> ExtractOutput
    ExtractOutput --> ReturnMain
    ReturnMain --> MainLoop

    style TaskTool fill:#fff3e0
    style SubLoop fill:#e8f5e9
    style SubResult fill:#e3f2fd
```

---

## 10. 数据流总览图

```mermaid
flowchart LR
    subgraph "Input"
        UserInput["用户输入"]
        Files["文件/资源"]
        Context["上下文"]
    end

    subgraph "Processing"
        Parse["解析输入"]
        CreateMsg["创建消息"]

        subgraph "Agent Loop"
            Resolve["解析工具/提示词"]
            Stream["LLM 流式调用"]
            Process["处理响应"]
            Execute["执行工具"]
        end
    end

    subgraph "Output"
        Response["响应文本"]
        ToolResults["工具结果"]
        FileChanges["文件变更"]
    end

    subgraph "Storage"
        SessionStore["会话存储"]
        MessageStore["消息存储"]
        SnapshotStore["快照存储"]
    end

    subgraph "Events"
        MessageEvent["消息事件"]
        PartEvent["Part 事件"]
        DiffEvent["Diff 事件"]
    end

    UserInput --> Parse
    Files --> Parse
    Context --> Parse

    Parse --> CreateMsg
    CreateMsg --> Resolve

    Resolve --> Stream
    Stream --> Process
    Process --> Execute
    Execute --> Process
    Process -->|continue| Resolve

    Process --> Response
    Execute --> ToolResults
    Execute --> FileChanges

    CreateMsg --> MessageStore
    Process --> MessageStore
    Execute --> SnapshotStore

    MessageStore --> MessageEvent
    Process --> PartEvent
    FileChanges --> DiffEvent

    style Stream fill:#e3f2fd
    style Execute fill:#fff3e0
    style MessageStore fill:#e8f5e9
```

---

## 11. Plugin 系统架构图

Plugin 系统是 OpenCode 的核心扩展机制，允许在关键执行点插入自定义逻辑。

### 11.1 Plugin 加载流程

```mermaid
flowchart TB
    subgraph "Plugin 初始化"
        Start([Plugin.init]) --> LoadConfig["加载配置<br/>Config.get()"]
        LoadConfig --> CheckBuiltin["加载内置插件<br/>opencode-copilot-auth<br/>opencode-anthropic-auth"]

        CheckBuiltin --> LoadCustom["加载自定义插件<br/>config.plugin[]"]

        LoadCustom --> ResolvePlugin{"解析插件路径"}

        ResolvePlugin -->|file://| LocalFile["本地文件"]
        ResolvePlugin -->|npm包| InstallPkg["BunProc.install()<br/>安装npm包"]

        LocalFile --> ImportMod["动态导入模块<br/>import(plugin)"]
        InstallPkg --> ImportMod

        ImportMod --> InitPlugin["初始化插件<br/>fn(PluginInput)"]
        InitPlugin --> RegisterHooks["注册 Hooks"]
        RegisterHooks --> Done([完成])
    end

    subgraph "PluginInput 上下文"
        Input["PluginInput"]
        Client["client: OpencodeClient"]
        Project["project: Project"]
        Directory["directory: string"]
        Worktree["worktree: string"]
        ServerUrl["serverUrl: URL"]
        Shell["$: BunShell"]

        Input --> Client
        Input --> Project
        Input --> Directory
        Input --> Worktree
        Input --> ServerUrl
        Input --> Shell
    end

    style Start fill:#e3f2fd
    style RegisterHooks fill:#e8f5e9
```

### 11.2 Plugin Hooks 触发点

```mermaid
flowchart LR
    subgraph "Chat Lifecycle Hooks"
        ChatMsg["chat.message<br/>消息创建后"]
        ChatParams["chat.params<br/>LLM参数调整"]
        ChatSystem["experimental.chat.system.transform<br/>系统提示词转换"]
        ChatMessages["experimental.chat.messages.transform<br/>消息历史转换"]
    end

    subgraph "Tool Lifecycle Hooks"
        ToolBefore["tool.execute.before<br/>工具执行前"]
        ToolAfter["tool.execute.after<br/>工具执行后"]
    end

    subgraph "Permission Hooks"
        PermAsk["permission.ask<br/>权限请求时"]
    end

    subgraph "Session Hooks"
        Compacting["experimental.session.compacting<br/>会话压缩时"]
        TextComplete["experimental.text.complete<br/>文本完成时"]
    end

    subgraph "Event Hooks"
        EventHook["event<br/>所有事件广播"]
        ConfigHook["config<br/>配置初始化"]
    end

    style ToolBefore fill:#fff3e0
    style ToolAfter fill:#fff3e0
    style PermAsk fill:#ffebee
```

### 11.3 Plugin Hooks 时序图

```mermaid
sequenceDiagram
    participant Agent as Agent Loop
    participant Plugin as Plugin System
    participant Hook as Plugin Hook
    participant Tool as Tool

    Note over Agent,Tool: 工具执行完整流程

    Agent->>Plugin: Plugin.trigger("chat.params", ...)
    Plugin->>Hook: 调用所有注册的 chat.params hooks
    Hook-->>Plugin: 修改后的参数 {temperature, topP, ...}
    Plugin-->>Agent: 返回修改后的参数

    Agent->>Agent: LLM.stream() 流式调用

    Agent->>Plugin: Plugin.trigger("chat.message", ...)
    Plugin->>Hook: 调用 chat.message hooks
    Hook-->>Agent: 消息处理完成

    Note over Agent,Tool: 工具调用

    Agent->>Plugin: Plugin.trigger("tool.execute.before", {tool, args})
    Plugin->>Hook: 调用 tool.execute.before hooks
    Hook->>Hook: 可修改 args
    Hook-->>Plugin: 返回修改后的 args
    Plugin-->>Agent: 继续执行

    Agent->>Tool: tool.execute(args)
    Tool-->>Agent: 返回结果 {title, output, metadata}

    Agent->>Plugin: Plugin.trigger("tool.execute.after", {tool, result})
    Plugin->>Hook: 调用 tool.execute.after hooks
    Hook->>Hook: 可修改 output/metadata
    Hook-->>Plugin: 返回修改后的结果
    Plugin-->>Agent: 最终结果
```

### 11.4 Hooks 接口定义

```typescript
interface Hooks {
  // 事件广播
  event?: (input: { event: Event }) => Promise<void>

  // 配置初始化
  config?: (input: Config) => Promise<void>

  // 自定义工具
  tool?: { [key: string]: ToolDefinition }

  // 认证扩展
  auth?: AuthHook

  // 消息创建后
  "chat.message"?: (
    input: { sessionID, agent?, model?, messageID?, variant? },
    output: { message: UserMessage, parts: Part[] }
  ) => Promise<void>

  // LLM 参数调整
  "chat.params"?: (
    input: { sessionID, agent, model, provider, message },
    output: { temperature, topP, topK, options }
  ) => Promise<void>

  // 权限请求
  "permission.ask"?: (
    input: Permission,
    output: { status: "ask" | "deny" | "allow" }
  ) => Promise<void>

  // 工具执行前
  "tool.execute.before"?: (
    input: { tool, sessionID, callID },
    output: { args: any }
  ) => Promise<void>

  // 工具执行后
  "tool.execute.after"?: (
    input: { tool, sessionID, callID },
    output: { title, output, metadata }
  ) => Promise<void>

  // 实验性: 系统提示词转换
  "experimental.chat.system.transform"?: (
    input: {},
    output: { system: string[] }
  ) => Promise<void>

  // 实验性: 消息历史转换
  "experimental.chat.messages.transform"?: (
    input: {},
    output: { messages: { info: Message, parts: Part[] }[] }
  ) => Promise<void>

  // 实验性: 会话压缩
  "experimental.session.compacting"?: (
    input: { sessionID },
    output: { context: string[], prompt?: string }
  ) => Promise<void>

  // 实验性: 文本完成
  "experimental.text.complete"?: (
    input: { sessionID, messageID, partID },
    output: { text: string }
  ) => Promise<void>
}
```

---

## 12. Tool 异常处理流程图

### 12.1 Tool 执行异常分类

```mermaid
flowchart TB
    subgraph "异常类型分类"
        ToolExec([工具执行]) --> ExecResult{"执行结果"}

        ExecResult -->|成功| Success["state: completed<br/>正常返回结果"]

        ExecResult -->|参数验证失败| ValidationError["Zod ValidationError<br/>参数不符合 Schema"]

        ExecResult -->|权限拒绝| PermissionError["RejectedError<br/>用户拒绝或规则禁止"]

        ExecResult -->|执行超时| TimeoutError["AbortError<br/>操作被中断"]

        ExecResult -->|运行时错误| RuntimeError["执行过程中抛出异常"]

        ExecResult -->|外部服务错误| ExternalError["网络错误/API错误"]
    end

    subgraph "异常处理结果"
        ValidationError --> ErrorState1["state: error<br/>error: 格式化的验证错误"]
        PermissionError --> ErrorState2["state: error<br/>error: 'Permission denied'"]
        TimeoutError --> ErrorState3["state: error<br/>error: 'Tool execution aborted'"]
        RuntimeError --> ErrorState4["state: error<br/>error: exception.toString()"]
        ExternalError --> ErrorState5["state: error<br/>error: 错误详情"]

        ErrorState1 --> ReturnLLM["返回错误信息给 LLM"]
        ErrorState2 --> BlockLoop["blocked = true<br/>终止当前 Loop"]
        ErrorState3 --> ReturnLLM
        ErrorState4 --> ReturnLLM
        ErrorState5 --> ReturnLLM
    end

    style ToolExec fill:#e3f2fd
    style Success fill:#e8f5e9
    style BlockLoop fill:#ffebee
```

### 12.2 Tool Error 处理时序图

```mermaid
sequenceDiagram
    participant Processor as SessionProcessor
    participant Stream as LLM Stream
    participant Tool as Tool Executor
    participant Storage as Storage
    participant Bus as Event Bus

    Note over Processor,Bus: 正常 tool-call 流程

    Stream->>Processor: tool-call event
    Processor->>Storage: 创建 ToolPart (state: pending)

    Processor->>Tool: 执行工具
    Tool->>Tool: 参数验证

    alt 参数验证失败
        Tool-->>Processor: ValidationError
        Processor->>Storage: 更新 ToolPart (state: error)
        Processor->>Bus: 发布 Part.Updated
        Processor-->>Stream: 返回错误信息
    else 权限被拒绝
        Tool-->>Processor: RejectedError
        Processor->>Storage: 更新 ToolPart (state: error)
        Processor->>Processor: blocked = true
        Note over Processor: Loop 将在完成后停止
    else 执行成功
        Tool-->>Processor: 返回结果
        Processor->>Storage: 更新 ToolPart (state: completed)
        Processor->>Bus: 发布 Part.Updated
    end

    Note over Processor,Bus: tool-error 事件处理

    Stream->>Processor: tool-error event
    Processor->>Processor: 查找对应 toolcall
    Processor->>Storage: 更新 ToolPart (state: error)

    alt 是 RejectedError
        Processor->>Processor: blocked = shouldBreak
    end

    Processor->>Bus: 发布 Part.Updated
```

### 12.3 Abort 处理流程

```mermaid
flowchart TB
    subgraph "Abort 触发源"
        UserCancel["用户取消操作"]
        Timeout["操作超时"]
        SessionEnd["会话结束"]
    end

    subgraph "Abort 传播"
        Signal["AbortController.signal"]
        Propagate["传播到所有异步操作"]
    end

    subgraph "清理流程"
        CheckParts["检查所有 ToolPart"]
        FindPending["查找非终态的 Parts<br/>pending / running"]
        UpdateError["更新为 error 状态<br/>'Tool execution aborted'"]
        SaveMessage["保存 AssistantMessage"]
    end

    UserCancel --> Signal
    Timeout --> Signal
    SessionEnd --> Signal

    Signal --> Propagate
    Propagate --> CheckParts
    CheckParts --> FindPending
    FindPending --> UpdateError
    UpdateError --> SaveMessage

    style Signal fill:#ffebee
    style UpdateError fill:#fff3e0
```

### 12.4 Tool State 状态机

```mermaid
stateDiagram-v2
    [*] --> pending: 创建 ToolPart

    pending --> running: 开始执行
    pending --> error: 验证失败/权限拒绝

    running --> completed: 执行成功
    running --> error: 执行失败/异常/中断

    completed --> [*]
    error --> [*]

    note right of pending: 工具调用已识别<br/>等待执行
    note right of running: 正在执行中<br/>可被中断
    note right of completed: 执行成功<br/>有 output
    note right of error: 执行失败<br/>有 error 信息
```

---

## 13. LLM 重试机制流程图

### 13.1 重试决策流程

```mermaid
flowchart TB
    subgraph "错误捕获"
        ProcessStart([processor.process]) --> TryCatch["try-catch 包裹流处理"]
        TryCatch --> CatchError{"捕获异常"}
    end

    subgraph "错误分析"
        CatchError --> ConvertError["MessageV2.fromError()<br/>转换为标准错误"]
        ConvertError --> CheckRetryable["SessionRetry.retryable()<br/>判断是否可重试"]

        CheckRetryable --> RetryResult{"可重试?"}

        RetryResult -->|否| SetError["设置 message.error"]
        SetError --> PublishError["Bus.publish(Session.Error)"]
        PublishError --> StopLoop["返回 'stop'"]

        RetryResult -->|是| GetReason["获取重试原因<br/>'Provider overloaded'<br/>'Too Many Requests'<br/>'Rate Limited'"]
    end

    subgraph "重试逻辑"
        GetReason --> IncrAttempt["attempt++"]
        IncrAttempt --> CalcDelay["SessionRetry.delay()<br/>计算延迟时间"]

        CalcDelay --> SetStatus["设置状态<br/>SessionStatus.set('retry')"]
        SetStatus --> Sleep["SessionRetry.sleep()<br/>等待延迟"]

        Sleep --> CheckAbort{"被中断?"}
        CheckAbort -->|是| StopLoop
        CheckAbort -->|否| ContinueLoop["continue<br/>重新执行流处理"]
    end

    style ProcessStart fill:#e3f2fd
    style StopLoop fill:#ffebee
    style ContinueLoop fill:#e8f5e9
```

### 13.2 延迟计算逻辑

```mermaid
flowchart TB
    subgraph "延迟计算 SessionRetry.delay()"
        Start([开始计算]) --> CheckAPIError{"是 APIError?"}

        CheckAPIError -->|是| CheckHeaders["检查响应头"]

        CheckHeaders --> HasRetryMs{"有 retry-after-ms?"}
        HasRetryMs -->|是| UseRetryMs["使用 retry-after-ms 毫秒值"]

        HasRetryMs -->|否| HasRetryAfter{"有 retry-after?"}
        HasRetryAfter -->|是| ParseRetryAfter["解析 retry-after<br/>秒数或HTTP日期"]
        HasRetryAfter -->|否| UseBackoff["指数退避<br/>INITIAL_DELAY * 2^(attempt-1)"]

        ParseRetryAfter --> UseRetryAfter["使用解析后的延迟"]

        CheckAPIError -->|否| UseBackoffCapped["指数退避(有上限)<br/>min(2^attempt * 2s, 30s)"]
    end

    subgraph "延迟常量"
        Initial["RETRY_INITIAL_DELAY = 2000ms"]
        Factor["RETRY_BACKOFF_FACTOR = 2"]
        MaxNoHeaders["RETRY_MAX_DELAY_NO_HEADERS = 30s"]
        MaxDelay["RETRY_MAX_DELAY = 2147483647ms"]
    end

    UseRetryMs --> Return([返回延迟])
    UseRetryAfter --> Return
    UseBackoff --> Return
    UseBackoffCapped --> Return

    style Start fill:#e3f2fd
    style Return fill:#e8f5e9
```

### 13.3 可重试错误类型

```mermaid
flowchart LR
    subgraph "可重试错误 Retryable Errors"
        APIError["APIError<br/>isRetryable=true"]
        Overloaded["Overloaded<br/>Provider 过载"]
        TooMany["too_many_requests<br/>请求过多"]
        RateLimit["rate_limit<br/>速率限制"]
        Exhausted["exhausted/unavailable<br/>资源耗尽"]
        NoKVSpace["no_kv_space<br/>KV空间不足"]
        ServerError["server_error<br/>服务端错误"]
    end

    subgraph "不可重试错误 Non-Retryable"
        AuthError["认证错误"]
        ValidationError["参数验证错误"]
        PermissionError["权限错误"]
        UnknownError["未知错误"]
    end

    APIError -->|"返回重试原因"| Retry[["重试"]]
    Overloaded --> Retry
    TooMany --> Retry
    RateLimit --> Retry
    Exhausted --> Retry
    NoKVSpace --> Retry
    ServerError --> Retry

    AuthError -->|"返回 undefined"| NoRetry[["不重试"]]
    ValidationError --> NoRetry
    PermissionError --> NoRetry
    UnknownError --> NoRetry

    style Retry fill:#e8f5e9
    style NoRetry fill:#ffebee
```

---

## 14. Doom Loop 检测机制

Doom Loop 是指 LLM 陷入重复调用相同工具的死循环，需要检测并阻止。

### 14.1 Doom Loop 检测流程

```mermaid
flowchart TB
    subgraph "检测逻辑 (processor.ts)"
        ToolCall([tool-call 事件]) --> GetToolName["获取工具名称<br/>value.toolName"]
        GetToolName --> CheckRepeat{"与上次相同?<br/>lastTool === toolName"}

        CheckRepeat -->|否| ResetCount["repeatCount = 0<br/>lastTool = toolName"]
        ResetCount --> Continue([继续执行])

        CheckRepeat -->|是| IncrCount["repeatCount++"]
        IncrCount --> CheckThreshold{"repeatCount >= 3?"}

        CheckThreshold -->|否| Continue

        CheckThreshold -->|是| DoomDetected["检测到 Doom Loop!"]
    end

    subgraph "Doom Loop 处理"
        DoomDetected --> GetAgent["获取 Agent 配置"]
        GetAgent --> AskPermission["PermissionNext.ask()<br/>permission: 'doom_loop'"]

        AskPermission --> PermResult{"用户决定"}

        PermResult -->|允许继续| AllowContinue["允许继续执行<br/>重置计数器"]
        PermResult -->|拒绝| RejectStop["blocked = true<br/>终止 Loop"]
    end

    AllowContinue --> Continue
    RejectStop --> Stop([返回 'stop'])

    style DoomDetected fill:#ffebee
    style AskPermission fill:#fff3e0
```

### 14.2 Doom Loop 检测时序图

```mermaid
sequenceDiagram
    participant LLM as LLM Stream
    participant Processor as SessionProcessor
    participant Permission as PermissionNext
    participant User as 用户

    Note over LLM,User: 连续相同工具调用

    LLM->>Processor: tool-call (bash)
    Processor->>Processor: lastTool="bash", repeatCount=0
    Processor->>Processor: 执行工具

    LLM->>Processor: tool-call (bash)
    Processor->>Processor: repeatCount=1
    Processor->>Processor: 执行工具

    LLM->>Processor: tool-call (bash)
    Processor->>Processor: repeatCount=2
    Processor->>Processor: 执行工具

    LLM->>Processor: tool-call (bash)
    Processor->>Processor: repeatCount=3 >= 3 ⚠️

    Note over Processor: 检测到 Doom Loop!

    Processor->>Permission: ask({permission: "doom_loop"})
    Permission->>User: 提示: "检测到重复工具调用"

    alt 用户允许继续
        User-->>Permission: 允许
        Permission-->>Processor: allow
        Processor->>Processor: repeatCount=0
        Processor->>Processor: 继续执行
    else 用户拒绝
        User-->>Permission: 拒绝
        Permission-->>Processor: deny
        Processor->>Processor: blocked=true
        Note over Processor: Loop 将停止
    end
```

### 14.3 Doom Loop 检测配置

```typescript
// 在 processor.ts 中的实现

let lastTool: string | undefined
let repeatCount = 0

// 每次 tool-call 事件时
case "tool-call":
  if (lastTool === value.toolName) {
    repeatCount++
    if (repeatCount >= 3) {
      // 触发 doom_loop 权限检查
      await PermissionNext.ask({
        permission: "doom_loop",
        patterns: [value.toolName],
        sessionID: input.assistantMessage.sessionID,
        metadata: {
          tool: value.toolName,
          repeatCount,
        },
        ruleset: agent.permission,
      })
      repeatCount = 0 // 用户允许后重置
    }
  } else {
    lastTool = value.toolName
    repeatCount = 0
  }
```

---

## 15. 关键代码文件索引

| 文件路径 | 职责描述 |
|---------|---------|
| `packages/opencode/src/session/prompt.ts` | Agent Loop 主入口，orchestration |
| `packages/opencode/src/session/processor.ts` | 流处理和工具执行 |
| `packages/opencode/src/session/message-v2.ts` | 消息和 Part 类型定义 |
| `packages/opencode/src/session/llm.ts` | LLM 流式调用封装 |
| `packages/opencode/src/session/retry.ts` | 重试机制实现 |
| `packages/opencode/src/session/index.ts` | 会话管理 |
| `packages/opencode/src/tool/tool.ts` | 工具接口定义 |
| `packages/opencode/src/tool/registry.ts` | 工具注册和解析 |
| `packages/opencode/src/agent/agent.ts` | Agent 配置定义 |
| `packages/opencode/src/provider/provider.ts` | Provider 管理 |
| `packages/opencode/src/permission/next.ts` | 权限系统 |
| `packages/opencode/src/plugin/index.ts` | Plugin 系统实现 |
| `packages/plugin/src/index.ts` | Plugin Hooks 接口定义 |
| `packages/opencode/src/storage/` | 持久化存储 |
| `packages/opencode/src/bus/` | 事件总线 |

---

## 16. 架构设计原则

### 16.1 消息驱动架构
- 所有状态变更通过事件总线广播
- 使用异步生成器实现流式处理
- 消息 Part 增量更新

### 16.2 插件化设计
- Tool Hooks 系统（before/after）
- 自定义工具注册
- Provider 扩展机制
- 实验性 Hooks 支持

### 16.3 权限优先
- 细粒度权限规则集
- 工具调用时权限评估
- 用户审批流程
- Doom Loop 检测保护

### 16.4 模块化工具系统
- 统一的 Tool 接口抽象
- Zod Schema 参数验证
- 元数据/上下文传递
- 异常状态机管理

### 16.5 状态隔离
- 每会话独立的 AbortController
- 消息父子关系追踪
- 会话级权限管理

### 16.6 容错与重试
- 可重试错误自动识别
- 指数退避重试策略
- 响应头优先延迟计算
- Abort 信号传播机制
