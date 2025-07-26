# Shared

Types:

- <code><a href="./src/resources/shared.ts">MessageAbortedError</a></code>
- <code><a href="./src/resources/shared.ts">ProviderAuthError</a></code>
- <code><a href="./src/resources/shared.ts">UnknownError</a></code>

# Event

Types:

- <code><a href="./src/resources/event.ts">EventListResponse</a></code>

Methods:

- <code title="get /event">client.event.<a href="./src/resources/event.ts">list</a>() -> EventListResponse</code>

# App

Types:

- <code><a href="./src/resources/app.ts">App</a></code>
- <code><a href="./src/resources/app.ts">Mode</a></code>
- <code><a href="./src/resources/app.ts">Model</a></code>
- <code><a href="./src/resources/app.ts">Provider</a></code>
- <code><a href="./src/resources/app.ts">AppInitResponse</a></code>
- <code><a href="./src/resources/app.ts">AppLogResponse</a></code>
- <code><a href="./src/resources/app.ts">AppModesResponse</a></code>
- <code><a href="./src/resources/app.ts">AppProvidersResponse</a></code>

Methods:

- <code title="get /app">client.app.<a href="./src/resources/app.ts">get</a>() -> App</code>
- <code title="post /app/init">client.app.<a href="./src/resources/app.ts">init</a>() -> AppInitResponse</code>
- <code title="post /log">client.app.<a href="./src/resources/app.ts">log</a>({ ...params }) -> AppLogResponse</code>
- <code title="get /mode">client.app.<a href="./src/resources/app.ts">modes</a>() -> AppModesResponse</code>
- <code title="get /config/providers">client.app.<a href="./src/resources/app.ts">providers</a>() -> AppProvidersResponse</code>

# Find

Types:

- <code><a href="./src/resources/find.ts">Match</a></code>
- <code><a href="./src/resources/find.ts">Symbol</a></code>
- <code><a href="./src/resources/find.ts">FindFilesResponse</a></code>
- <code><a href="./src/resources/find.ts">FindSymbolsResponse</a></code>
- <code><a href="./src/resources/find.ts">FindTextResponse</a></code>

Methods:

- <code title="get /find/file">client.find.<a href="./src/resources/find.ts">files</a>({ ...params }) -> FindFilesResponse</code>
- <code title="get /find/symbol">client.find.<a href="./src/resources/find.ts">symbols</a>({ ...params }) -> FindSymbolsResponse</code>
- <code title="get /find">client.find.<a href="./src/resources/find.ts">text</a>({ ...params }) -> FindTextResponse</code>

# File

Types:

- <code><a href="./src/resources/file.ts">File</a></code>
- <code><a href="./src/resources/file.ts">FileReadResponse</a></code>
- <code><a href="./src/resources/file.ts">FileStatusResponse</a></code>

Methods:

- <code title="get /file">client.file.<a href="./src/resources/file.ts">read</a>({ ...params }) -> FileReadResponse</code>
- <code title="get /file/status">client.file.<a href="./src/resources/file.ts">status</a>() -> FileStatusResponse</code>

# Config

Types:

- <code><a href="./src/resources/config.ts">Config</a></code>
- <code><a href="./src/resources/config.ts">KeybindsConfig</a></code>
- <code><a href="./src/resources/config.ts">McpLocalConfig</a></code>
- <code><a href="./src/resources/config.ts">McpRemoteConfig</a></code>
- <code><a href="./src/resources/config.ts">ModeConfig</a></code>

Methods:

- <code title="get /config">client.config.<a href="./src/resources/config.ts">get</a>() -> Config</code>

# Session

Types:

- <code><a href="./src/resources/session.ts">AssistantMessage</a></code>
- <code><a href="./src/resources/session.ts">FilePart</a></code>
- <code><a href="./src/resources/session.ts">FilePartInput</a></code>
- <code><a href="./src/resources/session.ts">FilePartSource</a></code>
- <code><a href="./src/resources/session.ts">FilePartSourceText</a></code>
- <code><a href="./src/resources/session.ts">FileSource</a></code>
- <code><a href="./src/resources/session.ts">Message</a></code>
- <code><a href="./src/resources/session.ts">Part</a></code>
- <code><a href="./src/resources/session.ts">Session</a></code>
- <code><a href="./src/resources/session.ts">SnapshotPart</a></code>
- <code><a href="./src/resources/session.ts">StepFinishPart</a></code>
- <code><a href="./src/resources/session.ts">StepStartPart</a></code>
- <code><a href="./src/resources/session.ts">SymbolSource</a></code>
- <code><a href="./src/resources/session.ts">TextPart</a></code>
- <code><a href="./src/resources/session.ts">TextPartInput</a></code>
- <code><a href="./src/resources/session.ts">ToolPart</a></code>
- <code><a href="./src/resources/session.ts">ToolStateCompleted</a></code>
- <code><a href="./src/resources/session.ts">ToolStateError</a></code>
- <code><a href="./src/resources/session.ts">ToolStatePending</a></code>
- <code><a href="./src/resources/session.ts">ToolStateRunning</a></code>
- <code><a href="./src/resources/session.ts">UserMessage</a></code>
- <code><a href="./src/resources/session.ts">SessionListResponse</a></code>
- <code><a href="./src/resources/session.ts">SessionDeleteResponse</a></code>
- <code><a href="./src/resources/session.ts">SessionAbortResponse</a></code>
- <code><a href="./src/resources/session.ts">SessionInitResponse</a></code>
- <code><a href="./src/resources/session.ts">SessionMessagesResponse</a></code>
- <code><a href="./src/resources/session.ts">SessionSummarizeResponse</a></code>

Methods:

- <code title="post /session">client.session.<a href="./src/resources/session.ts">create</a>() -> Session</code>
- <code title="get /session">client.session.<a href="./src/resources/session.ts">list</a>() -> SessionListResponse</code>
- <code title="delete /session/{id}">client.session.<a href="./src/resources/session.ts">delete</a>(id) -> SessionDeleteResponse</code>
- <code title="post /session/{id}/abort">client.session.<a href="./src/resources/session.ts">abort</a>(id) -> SessionAbortResponse</code>
- <code title="post /session/{id}/message">client.session.<a href="./src/resources/session.ts">chat</a>(id, { ...params }) -> AssistantMessage</code>
- <code title="post /session/{id}/init">client.session.<a href="./src/resources/session.ts">init</a>(id, { ...params }) -> SessionInitResponse</code>
- <code title="get /session/{id}/message">client.session.<a href="./src/resources/session.ts">messages</a>(id) -> SessionMessagesResponse</code>
- <code title="post /session/{id}/revert">client.session.<a href="./src/resources/session.ts">revert</a>(id, { ...params }) -> Session</code>
- <code title="post /session/{id}/share">client.session.<a href="./src/resources/session.ts">share</a>(id) -> Session</code>
- <code title="post /session/{id}/summarize">client.session.<a href="./src/resources/session.ts">summarize</a>(id, { ...params }) -> SessionSummarizeResponse</code>
- <code title="post /session/{id}/unrevert">client.session.<a href="./src/resources/session.ts">unrevert</a>(id) -> Session</code>
- <code title="delete /session/{id}/share">client.session.<a href="./src/resources/session.ts">unshare</a>(id) -> Session</code>

# Tui

Types:

- <code><a href="./src/resources/tui.ts">TuiAppendPromptResponse</a></code>
- <code><a href="./src/resources/tui.ts">TuiOpenHelpResponse</a></code>

Methods:

- <code title="post /tui/append-prompt">client.tui.<a href="./src/resources/tui.ts">appendPrompt</a>({ ...params }) -> TuiAppendPromptResponse</code>
- <code title="post /tui/open-help">client.tui.<a href="./src/resources/tui.ts">openHelp</a>() -> TuiOpenHelpResponse</code>
