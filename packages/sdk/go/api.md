# Shared Response Types

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go/shared">shared</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go/shared#MessageAbortedError">MessageAbortedError</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go/shared">shared</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go/shared#ProviderAuthError">ProviderAuthError</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go/shared">shared</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go/shared#UnknownError">UnknownError</a>

# Event

Response Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#EventListResponse">EventListResponse</a>

Methods:

- <code title="get /event">client.Event.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#EventService.List">List</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#EventListParams">EventListParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#EventListResponse">EventListResponse</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>

# Path

Response Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Path">Path</a>

Methods:

- <code title="get /path">client.Path.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#PathService.Get">Get</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#PathGetParams">PathGetParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Path">Path</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>

# App

Response Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Model">Model</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Provider">Provider</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#AppProvidersResponse">AppProvidersResponse</a>

Methods:

- <code title="post /log">client.App.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#AppService.Log">Log</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, params <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#AppLogParams">AppLogParams</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="get /config/providers">client.App.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#AppService.Providers">Providers</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#AppProvidersParams">AppProvidersParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#AppProvidersResponse">AppProvidersResponse</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>

# Agent

Response Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Agent">Agent</a>

Methods:

- <code title="get /agent">client.Agent.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#AgentService.List">List</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#AgentListParams">AgentListParams</a>) ([]<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Agent">Agent</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>

# Find

Response Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Symbol">Symbol</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindTextResponse">FindTextResponse</a>

Methods:

- <code title="get /find/file">client.Find.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindService.Files">Files</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindFilesParams">FindFilesParams</a>) ([]<a href="https://pkg.go.dev/builtin#string">string</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="get /find/symbol">client.Find.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindService.Symbols">Symbols</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindSymbolsParams">FindSymbolsParams</a>) ([]<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Symbol">Symbol</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="get /find">client.Find.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindService.Text">Text</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindTextParams">FindTextParams</a>) ([]<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindTextResponse">FindTextResponse</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>

# File

Response Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#File">File</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileNode">FileNode</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileReadResponse">FileReadResponse</a>

Methods:

- <code title="get /file">client.File.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileService.List">List</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileListParams">FileListParams</a>) ([]<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileNode">FileNode</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="get /file/content">client.File.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileService.Read">Read</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileReadParams">FileReadParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileReadResponse">FileReadResponse</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="get /file/status">client.File.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileService.Status">Status</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileStatusParams">FileStatusParams</a>) ([]<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#File">File</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>

# Config

Response Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Config">Config</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#KeybindsConfig">KeybindsConfig</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#McpLocalConfig">McpLocalConfig</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#McpRemoteConfig">McpRemoteConfig</a>

Methods:

- <code title="get /config">client.Config.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ConfigService.Get">Get</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ConfigGetParams">ConfigGetParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Config">Config</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>

# Command

Response Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Command">Command</a>

Methods:

- <code title="get /command">client.Command.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#CommandService.List">List</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#CommandListParams">CommandListParams</a>) ([]<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Command">Command</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>

# Project

Response Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Project">Project</a>

Methods:

- <code title="get /project">client.Project.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ProjectService.List">List</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ProjectListParams">ProjectListParams</a>) ([]<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Project">Project</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="get /project/current">client.Project.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ProjectService.Current">Current</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ProjectCurrentParams">ProjectCurrentParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Project">Project</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>

# Session

Params Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#AgentPartInputParam">AgentPartInputParam</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FilePartInputParam">FilePartInputParam</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FilePartSourceUnionParam">FilePartSourceUnionParam</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FilePartSourceTextParam">FilePartSourceTextParam</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileSourceParam">FileSourceParam</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SymbolSourceParam">SymbolSourceParam</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TextPartInputParam">TextPartInputParam</a>

Response Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#AgentPart">AgentPart</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#AssistantMessage">AssistantMessage</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FilePart">FilePart</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FilePartSource">FilePartSource</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FilePartSourceText">FilePartSourceText</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileSource">FileSource</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Message">Message</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Part">Part</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ReasoningPart">ReasoningPart</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Session">Session</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SnapshotPart">SnapshotPart</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#StepFinishPart">StepFinishPart</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#StepStartPart">StepStartPart</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SymbolSource">SymbolSource</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TextPart">TextPart</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ToolPart">ToolPart</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ToolStateCompleted">ToolStateCompleted</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ToolStateError">ToolStateError</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ToolStatePending">ToolStatePending</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ToolStateRunning">ToolStateRunning</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#UserMessage">UserMessage</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionCommandResponse">SessionCommandResponse</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionMessageResponse">SessionMessageResponse</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionMessagesResponse">SessionMessagesResponse</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionPromptResponse">SessionPromptResponse</a>

Methods:

- <code title="post /session">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.New">New</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, params <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionNewParams">SessionNewParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Session">Session</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="patch /session/{id}">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Update">Update</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, params <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionUpdateParams">SessionUpdateParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Session">Session</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="get /session">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.List">List</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionListParams">SessionListParams</a>) ([]<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Session">Session</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="delete /session/{id}">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Delete">Delete</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, body <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionDeleteParams">SessionDeleteParams</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /session/{id}/abort">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Abort">Abort</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, body <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionAbortParams">SessionAbortParams</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="get /session/{id}/children">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Children">Children</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionChildrenParams">SessionChildrenParams</a>) ([]<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Session">Session</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /session/{id}/command">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Command">Command</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, params <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionCommandParams">SessionCommandParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionCommandResponse">SessionCommandResponse</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="get /session/{id}">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Get">Get</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionGetParams">SessionGetParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Session">Session</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /session/{id}/init">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Init">Init</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, params <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionInitParams">SessionInitParams</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="get /session/{id}/message/{messageID}">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Message">Message</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, messageID <a href="https://pkg.go.dev/builtin#string">string</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionMessageParams">SessionMessageParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionMessageResponse">SessionMessageResponse</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="get /session/{id}/message">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Messages">Messages</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionMessagesParams">SessionMessagesParams</a>) ([]<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionMessagesResponse">SessionMessagesResponse</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /session/{id}/message">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Prompt">Prompt</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, params <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionPromptParams">SessionPromptParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionPromptResponse">SessionPromptResponse</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /session/{id}/revert">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Revert">Revert</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, params <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionRevertParams">SessionRevertParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Session">Session</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /session/{id}/share">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Share">Share</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, body <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionShareParams">SessionShareParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Session">Session</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /session/{id}/shell">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Shell">Shell</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, params <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionShellParams">SessionShellParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#AssistantMessage">AssistantMessage</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /session/{id}/summarize">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Summarize">Summarize</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, params <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionSummarizeParams">SessionSummarizeParams</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /session/{id}/unrevert">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Unrevert">Unrevert</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, body <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionUnrevertParams">SessionUnrevertParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Session">Session</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="delete /session/{id}/share">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Unshare">Unshare</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, body <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionUnshareParams">SessionUnshareParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Session">Session</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>

## Permissions

Response Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Permission">Permission</a>

Methods:

- <code title="post /session/{id}/permissions/{permissionID}">client.Session.Permissions.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionPermissionService.Respond">Respond</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, permissionID <a href="https://pkg.go.dev/builtin#string">string</a>, params <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionPermissionRespondParams">SessionPermissionRespondParams</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>

# Tui

Methods:

- <code title="post /tui/append-prompt">client.Tui.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiService.AppendPrompt">AppendPrompt</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, params <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiAppendPromptParams">TuiAppendPromptParams</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /tui/clear-prompt">client.Tui.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiService.ClearPrompt">ClearPrompt</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, body <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiClearPromptParams">TuiClearPromptParams</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /tui/execute-command">client.Tui.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiService.ExecuteCommand">ExecuteCommand</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, params <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiExecuteCommandParams">TuiExecuteCommandParams</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /tui/open-help">client.Tui.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiService.OpenHelp">OpenHelp</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, body <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiOpenHelpParams">TuiOpenHelpParams</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /tui/open-models">client.Tui.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiService.OpenModels">OpenModels</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, body <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiOpenModelsParams">TuiOpenModelsParams</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /tui/open-sessions">client.Tui.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiService.OpenSessions">OpenSessions</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, body <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiOpenSessionsParams">TuiOpenSessionsParams</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /tui/open-themes">client.Tui.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiService.OpenThemes">OpenThemes</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, body <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiOpenThemesParams">TuiOpenThemesParams</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /tui/show-toast">client.Tui.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiService.ShowToast">ShowToast</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, params <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiShowToastParams">TuiShowToastParams</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /tui/submit-prompt">client.Tui.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiService.SubmitPrompt">SubmitPrompt</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, body <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TuiSubmitPromptParams">TuiSubmitPromptParams</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
