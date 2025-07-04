# Shared Response Types

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go/shared">shared</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go/shared#ProviderAuthError">ProviderAuthError</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go/shared">shared</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go/shared#UnknownError">UnknownError</a>

# Event

Response Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#EventListResponse">EventListResponse</a>

Methods:

- <code title="get /event">client.Event.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#EventService.List">List</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#EventListResponse">EventListResponse</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>

# App

Response Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#App">App</a>

Methods:

- <code title="get /app">client.App.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#AppService.Get">Get</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#App">App</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /app/init">client.App.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#AppService.Init">Init</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>

# Find

Response Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindSymbolsResponse">FindSymbolsResponse</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindTextResponse">FindTextResponse</a>

Methods:

- <code title="get /find/file">client.Find.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindService.Files">Files</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindFilesParams">FindFilesParams</a>) ([]<a href="https://pkg.go.dev/builtin#string">string</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="get /find/symbol">client.Find.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindService.Symbols">Symbols</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindSymbolsParams">FindSymbolsParams</a>) ([]<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindSymbolsResponse">FindSymbolsResponse</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="get /find">client.Find.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindService.Text">Text</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindTextParams">FindTextParams</a>) ([]<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FindTextResponse">FindTextResponse</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>

# File

Response Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileReadResponse">FileReadResponse</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileStatusResponse">FileStatusResponse</a>

Methods:

- <code title="get /file">client.File.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileService.Read">Read</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, query <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileReadParams">FileReadParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileReadResponse">FileReadResponse</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="get /file/status">client.File.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileService.Status">Status</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>) ([]<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FileStatusResponse">FileStatusResponse</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>

# Config

Response Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Config">Config</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Keybinds">Keybinds</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#McpLocal">McpLocal</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#McpRemote">McpRemote</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Model">Model</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Provider">Provider</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ConfigProvidersResponse">ConfigProvidersResponse</a>

Methods:

- <code title="get /config">client.Config.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ConfigService.Get">Get</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Config">Config</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="get /config/providers">client.Config.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ConfigService.Providers">Providers</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ConfigProvidersResponse">ConfigProvidersResponse</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>

# Session

Params Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FilePartParam">FilePartParam</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#MessagePartUnionParam">MessagePartUnionParam</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ReasoningPartParam">ReasoningPartParam</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SourceURLPartParam">SourceURLPartParam</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#StepStartPartParam">StepStartPartParam</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TextPartParam">TextPartParam</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ToolCallParam">ToolCallParam</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ToolInvocationPartParam">ToolInvocationPartParam</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ToolPartialCallParam">ToolPartialCallParam</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ToolResultParam">ToolResultParam</a>

Response Types:

- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#FilePart">FilePart</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Message">Message</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#MessagePart">MessagePart</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ReasoningPart">ReasoningPart</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Session">Session</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SourceURLPart">SourceURLPart</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#StepStartPart">StepStartPart</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#TextPart">TextPart</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ToolCall">ToolCall</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ToolInvocationPart">ToolInvocationPart</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ToolPartialCall">ToolPartialCall</a>
- <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#ToolResult">ToolResult</a>

Methods:

- <code title="post /session">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.New">New</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Session">Session</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="get /session">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.List">List</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>) ([]<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Session">Session</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="delete /session/{id}">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Delete">Delete</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /session/{id}/abort">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Abort">Abort</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /session/{id}/message">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Chat">Chat</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, body <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionChatParams">SessionChatParams</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Message">Message</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /session/{id}/init">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Init">Init</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, body <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionInitParams">SessionInitParams</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="get /session/{id}/message">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Messages">Messages</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>) ([]<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Message">Message</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /session/{id}/share">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Share">Share</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Session">Session</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="post /session/{id}/summarize">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Summarize">Summarize</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>, body <a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionSummarizeParams">SessionSummarizeParams</a>) (<a href="https://pkg.go.dev/builtin#bool">bool</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
- <code title="delete /session/{id}/share">client.Session.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#SessionService.Unshare">Unshare</a>(ctx <a href="https://pkg.go.dev/context">context</a>.<a href="https://pkg.go.dev/context#Context">Context</a>, id <a href="https://pkg.go.dev/builtin#string">string</a>) (<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go">opencode</a>.<a href="https://pkg.go.dev/github.com/sst/opencode-sdk-go#Session">Session</a>, <a href="https://pkg.go.dev/builtin#error">error</a>)</code>
