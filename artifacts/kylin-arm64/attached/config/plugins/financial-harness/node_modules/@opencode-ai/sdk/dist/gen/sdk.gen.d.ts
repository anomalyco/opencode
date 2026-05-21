import type { Options as ClientOptions, TDataShape, Client } from "./client/index.js";
import type { GlobalEventData, GlobalEventResponses, ProjectListData, ProjectListResponses, ProjectCurrentData, ProjectCurrentResponses, PtyListData, PtyListResponses, PtyCreateData, PtyCreateResponses, PtyCreateErrors, PtyRemoveData, PtyRemoveResponses, PtyRemoveErrors, PtyGetData, PtyGetResponses, PtyGetErrors, PtyUpdateData, PtyUpdateResponses, PtyUpdateErrors, PtyConnectData, PtyConnectResponses, PtyConnectErrors, ConfigGetData, ConfigGetResponses, ConfigUpdateData, ConfigUpdateResponses, ConfigUpdateErrors, ToolIdsData, ToolIdsResponses, ToolIdsErrors, ToolListData, ToolListResponses, ToolListErrors, InstanceDisposeData, InstanceDisposeResponses, PathGetData, PathGetResponses, VcsGetData, VcsGetResponses, SessionListData, SessionListResponses, SessionCreateData, SessionCreateResponses, SessionCreateErrors, SessionStatusData, SessionStatusResponses, SessionStatusErrors, SessionDeleteData, SessionDeleteResponses, SessionDeleteErrors, SessionGetData, SessionGetResponses, SessionGetErrors, SessionUpdateData, SessionUpdateResponses, SessionUpdateErrors, SessionChildrenData, SessionChildrenResponses, SessionChildrenErrors, SessionTodoData, SessionTodoResponses, SessionTodoErrors, SessionInitData, SessionInitResponses, SessionInitErrors, SessionForkData, SessionForkResponses, SessionAbortData, SessionAbortResponses, SessionAbortErrors, SessionUnshareData, SessionUnshareResponses, SessionUnshareErrors, SessionShareData, SessionShareResponses, SessionShareErrors, SessionDiffData, SessionDiffResponses, SessionDiffErrors, SessionSummarizeData, SessionSummarizeResponses, SessionSummarizeErrors, SessionMessagesData, SessionMessagesResponses, SessionMessagesErrors, SessionPromptData, SessionPromptResponses, SessionPromptErrors, SessionMessageData, SessionMessageResponses, SessionMessageErrors, SessionPromptAsyncData, SessionPromptAsyncResponses, SessionPromptAsyncErrors, SessionCommandData, SessionCommandResponses, SessionCommandErrors, SessionShellData, SessionShellResponses, SessionShellErrors, SessionRevertData, SessionRevertResponses, SessionRevertErrors, SessionUnrevertData, SessionUnrevertResponses, SessionUnrevertErrors, PostSessionIdPermissionsPermissionIdData, PostSessionIdPermissionsPermissionIdResponses, PostSessionIdPermissionsPermissionIdErrors, CommandListData, CommandListResponses, ConfigProvidersData, ConfigProvidersResponses, ProviderListData, ProviderListResponses, ProviderAuthData, ProviderAuthResponses, ProviderOauthAuthorizeData, ProviderOauthAuthorizeResponses, ProviderOauthAuthorizeErrors, ProviderOauthCallbackData, ProviderOauthCallbackResponses, ProviderOauthCallbackErrors, FindTextData, FindTextResponses, FindFilesData, FindFilesResponses, FindSymbolsData, FindSymbolsResponses, FileListData, FileListResponses, FileReadData, FileReadResponses, FileStatusData, FileStatusResponses, AppLogData, AppLogResponses, AppLogErrors, AppAgentsData, AppAgentsResponses, McpStatusData, McpStatusResponses, McpAddData, McpAddResponses, McpAddErrors, McpAuthRemoveData, McpAuthRemoveResponses, McpAuthRemoveErrors, McpAuthStartData, McpAuthStartResponses, McpAuthStartErrors, McpAuthCallbackData, McpAuthCallbackResponses, McpAuthCallbackErrors, McpAuthAuthenticateData, McpAuthAuthenticateResponses, McpAuthAuthenticateErrors, McpConnectData, McpConnectResponses, McpDisconnectData, McpDisconnectResponses, LspStatusData, LspStatusResponses, FormatterStatusData, FormatterStatusResponses, TuiAppendPromptData, TuiAppendPromptResponses, TuiAppendPromptErrors, TuiOpenHelpData, TuiOpenHelpResponses, TuiOpenSessionsData, TuiOpenSessionsResponses, TuiOpenThemesData, TuiOpenThemesResponses, TuiOpenModelsData, TuiOpenModelsResponses, TuiSubmitPromptData, TuiSubmitPromptResponses, TuiClearPromptData, TuiClearPromptResponses, TuiExecuteCommandData, TuiExecuteCommandResponses, TuiExecuteCommandErrors, TuiShowToastData, TuiShowToastResponses, TuiPublishData, TuiPublishResponses, TuiPublishErrors, TuiControlNextData, TuiControlNextResponses, TuiControlResponseData, TuiControlResponseResponses, AuthSetData, AuthSetResponses, AuthSetErrors, EventSubscribeData, EventSubscribeResponses } from "./types.gen.js";
export type Options<TData extends TDataShape = TDataShape, ThrowOnError extends boolean = boolean> = ClientOptions<TData, ThrowOnError> & {
    /**
     * You can provide a client instance returned by `createClient()` instead of
     * individual options. This might be also useful if you want to implement a
     * custom client.
     */
    client?: Client;
    /**
     * You can pass arbitrary values through the `meta` object. This can be
     * used to access values that aren't defined as part of the SDK function.
     */
    meta?: Record<string, unknown>;
};
declare class _HeyApiClient {
    protected _client: Client;
    constructor(args?: {
        client?: Client;
    });
}
declare class Global extends _HeyApiClient {
    /**
     * Get events
     */
    event<ThrowOnError extends boolean = false>(options?: Options<GlobalEventData, ThrowOnError>): Promise<import("./core/serverSentEvents.gen.js").ServerSentEventsResult<GlobalEventResponses, unknown>>;
}
declare class Project extends _HeyApiClient {
    /**
     * List all projects
     */
    list<ThrowOnError extends boolean = false>(options?: Options<ProjectListData, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProjectListResponses, unknown, ThrowOnError, "fields">;
    /**
     * Get the current project
     */
    current<ThrowOnError extends boolean = false>(options?: Options<ProjectCurrentData, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProjectCurrentResponses, unknown, ThrowOnError, "fields">;
}
declare class Pty extends _HeyApiClient {
    /**
     * List all PTY sessions
     */
    list<ThrowOnError extends boolean = false>(options?: Options<PtyListData, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyListResponses, unknown, ThrowOnError, "fields">;
    /**
     * Create a new PTY session
     */
    create<ThrowOnError extends boolean = false>(options?: Options<PtyCreateData, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyCreateResponses, PtyCreateErrors, ThrowOnError, "fields">;
    /**
     * Remove a PTY session
     */
    remove<ThrowOnError extends boolean = false>(options: Options<PtyRemoveData, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyRemoveResponses, PtyRemoveErrors, ThrowOnError, "fields">;
    /**
     * Get PTY session info
     */
    get<ThrowOnError extends boolean = false>(options: Options<PtyGetData, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyGetResponses, PtyGetErrors, ThrowOnError, "fields">;
    /**
     * Update PTY session
     */
    update<ThrowOnError extends boolean = false>(options: Options<PtyUpdateData, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyUpdateResponses, PtyUpdateErrors, ThrowOnError, "fields">;
    /**
     * Connect to a PTY session
     */
    connect<ThrowOnError extends boolean = false>(options: Options<PtyConnectData, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyConnectResponses, PtyConnectErrors, ThrowOnError, "fields">;
}
declare class Config extends _HeyApiClient {
    /**
     * Get config info
     */
    get<ThrowOnError extends boolean = false>(options?: Options<ConfigGetData, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigGetResponses, unknown, ThrowOnError, "fields">;
    /**
     * Update config
     */
    update<ThrowOnError extends boolean = false>(options?: Options<ConfigUpdateData, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigUpdateResponses, ConfigUpdateErrors, ThrowOnError, "fields">;
    /**
     * List all providers
     */
    providers<ThrowOnError extends boolean = false>(options?: Options<ConfigProvidersData, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigProvidersResponses, unknown, ThrowOnError, "fields">;
}
declare class Tool extends _HeyApiClient {
    /**
     * List all tool IDs (including built-in and dynamically registered)
     */
    ids<ThrowOnError extends boolean = false>(options?: Options<ToolIdsData, ThrowOnError>): import("./client/types.gen.js").RequestResult<ToolIdsResponses, ToolIdsErrors, ThrowOnError, "fields">;
    /**
     * List tools with JSON schema parameters for a provider/model
     */
    list<ThrowOnError extends boolean = false>(options: Options<ToolListData, ThrowOnError>): import("./client/types.gen.js").RequestResult<ToolListResponses, ToolListErrors, ThrowOnError, "fields">;
}
declare class Instance extends _HeyApiClient {
    /**
     * Dispose the current instance
     */
    dispose<ThrowOnError extends boolean = false>(options?: Options<InstanceDisposeData, ThrowOnError>): import("./client/types.gen.js").RequestResult<InstanceDisposeResponses, unknown, ThrowOnError, "fields">;
}
declare class Path extends _HeyApiClient {
    /**
     * Get the current path
     */
    get<ThrowOnError extends boolean = false>(options?: Options<PathGetData, ThrowOnError>): import("./client/types.gen.js").RequestResult<PathGetResponses, unknown, ThrowOnError, "fields">;
}
declare class Vcs extends _HeyApiClient {
    /**
     * Get VCS info for the current instance
     */
    get<ThrowOnError extends boolean = false>(options?: Options<VcsGetData, ThrowOnError>): import("./client/types.gen.js").RequestResult<VcsGetResponses, unknown, ThrowOnError, "fields">;
}
declare class Session extends _HeyApiClient {
    /**
     * List all sessions
     */
    list<ThrowOnError extends boolean = false>(options?: Options<SessionListData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionListResponses, unknown, ThrowOnError, "fields">;
    /**
     * Create a new session
     */
    create<ThrowOnError extends boolean = false>(options?: Options<SessionCreateData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionCreateResponses, SessionCreateErrors, ThrowOnError, "fields">;
    /**
     * Get session status
     */
    status<ThrowOnError extends boolean = false>(options?: Options<SessionStatusData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionStatusResponses, SessionStatusErrors, ThrowOnError, "fields">;
    /**
     * Delete a session and all its data
     */
    delete<ThrowOnError extends boolean = false>(options: Options<SessionDeleteData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionDeleteResponses, SessionDeleteErrors, ThrowOnError, "fields">;
    /**
     * Get session
     */
    get<ThrowOnError extends boolean = false>(options: Options<SessionGetData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionGetResponses, SessionGetErrors, ThrowOnError, "fields">;
    /**
     * Update session properties
     */
    update<ThrowOnError extends boolean = false>(options: Options<SessionUpdateData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionUpdateResponses, SessionUpdateErrors, ThrowOnError, "fields">;
    /**
     * Get a session's children
     */
    children<ThrowOnError extends boolean = false>(options: Options<SessionChildrenData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionChildrenResponses, SessionChildrenErrors, ThrowOnError, "fields">;
    /**
     * Get the todo list for a session
     */
    todo<ThrowOnError extends boolean = false>(options: Options<SessionTodoData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionTodoResponses, SessionTodoErrors, ThrowOnError, "fields">;
    /**
     * Analyze the app and create an AGENTS.md file
     */
    init<ThrowOnError extends boolean = false>(options: Options<SessionInitData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionInitResponses, SessionInitErrors, ThrowOnError, "fields">;
    /**
     * Fork an existing session at a specific message
     */
    fork<ThrowOnError extends boolean = false>(options: Options<SessionForkData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionForkResponses, unknown, ThrowOnError, "fields">;
    /**
     * Abort a session
     */
    abort<ThrowOnError extends boolean = false>(options: Options<SessionAbortData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionAbortResponses, SessionAbortErrors, ThrowOnError, "fields">;
    /**
     * Unshare the session
     */
    unshare<ThrowOnError extends boolean = false>(options: Options<SessionUnshareData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionUnshareResponses, SessionUnshareErrors, ThrowOnError, "fields">;
    /**
     * Share a session
     */
    share<ThrowOnError extends boolean = false>(options: Options<SessionShareData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionShareResponses, SessionShareErrors, ThrowOnError, "fields">;
    /**
     * Get the diff for this session
     */
    diff<ThrowOnError extends boolean = false>(options: Options<SessionDiffData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionDiffResponses, SessionDiffErrors, ThrowOnError, "fields">;
    /**
     * Summarize the session
     */
    summarize<ThrowOnError extends boolean = false>(options: Options<SessionSummarizeData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionSummarizeResponses, SessionSummarizeErrors, ThrowOnError, "fields">;
    /**
     * List messages for a session
     */
    messages<ThrowOnError extends boolean = false>(options: Options<SessionMessagesData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionMessagesResponses, SessionMessagesErrors, ThrowOnError, "fields">;
    /**
     * Create and send a new message to a session
     */
    prompt<ThrowOnError extends boolean = false>(options: Options<SessionPromptData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionPromptResponses, SessionPromptErrors, ThrowOnError, "fields">;
    /**
     * Get a message from a session
     */
    message<ThrowOnError extends boolean = false>(options: Options<SessionMessageData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionMessageResponses, SessionMessageErrors, ThrowOnError, "fields">;
    /**
     * Create and send a new message to a session, start if needed and return immediately
     */
    promptAsync<ThrowOnError extends boolean = false>(options: Options<SessionPromptAsyncData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionPromptAsyncResponses, SessionPromptAsyncErrors, ThrowOnError, "fields">;
    /**
     * Send a new command to a session
     */
    command<ThrowOnError extends boolean = false>(options: Options<SessionCommandData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionCommandResponses, SessionCommandErrors, ThrowOnError, "fields">;
    /**
     * Run a shell command
     */
    shell<ThrowOnError extends boolean = false>(options: Options<SessionShellData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionShellResponses, SessionShellErrors, ThrowOnError, "fields">;
    /**
     * Revert a message
     */
    revert<ThrowOnError extends boolean = false>(options: Options<SessionRevertData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionRevertResponses, SessionRevertErrors, ThrowOnError, "fields">;
    /**
     * Restore all reverted messages
     */
    unrevert<ThrowOnError extends boolean = false>(options: Options<SessionUnrevertData, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionUnrevertResponses, SessionUnrevertErrors, ThrowOnError, "fields">;
}
declare class Command extends _HeyApiClient {
    /**
     * List all commands
     */
    list<ThrowOnError extends boolean = false>(options?: Options<CommandListData, ThrowOnError>): import("./client/types.gen.js").RequestResult<CommandListResponses, unknown, ThrowOnError, "fields">;
}
declare class Oauth extends _HeyApiClient {
    /**
     * Authorize a provider using OAuth
     */
    authorize<ThrowOnError extends boolean = false>(options: Options<ProviderOauthAuthorizeData, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProviderOauthAuthorizeResponses, ProviderOauthAuthorizeErrors, ThrowOnError, "fields">;
    /**
     * Handle OAuth callback for a provider
     */
    callback<ThrowOnError extends boolean = false>(options: Options<ProviderOauthCallbackData, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProviderOauthCallbackResponses, ProviderOauthCallbackErrors, ThrowOnError, "fields">;
}
declare class Provider extends _HeyApiClient {
    /**
     * List all providers
     */
    list<ThrowOnError extends boolean = false>(options?: Options<ProviderListData, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProviderListResponses, unknown, ThrowOnError, "fields">;
    /**
     * Get provider authentication methods
     */
    auth<ThrowOnError extends boolean = false>(options?: Options<ProviderAuthData, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProviderAuthResponses, unknown, ThrowOnError, "fields">;
    oauth: Oauth;
}
declare class Find extends _HeyApiClient {
    /**
     * Find text in files
     */
    text<ThrowOnError extends boolean = false>(options: Options<FindTextData, ThrowOnError>): import("./client/types.gen.js").RequestResult<FindTextResponses, unknown, ThrowOnError, "fields">;
    /**
     * Find files
     */
    files<ThrowOnError extends boolean = false>(options: Options<FindFilesData, ThrowOnError>): import("./client/types.gen.js").RequestResult<FindFilesResponses, unknown, ThrowOnError, "fields">;
    /**
     * Find workspace symbols
     */
    symbols<ThrowOnError extends boolean = false>(options: Options<FindSymbolsData, ThrowOnError>): import("./client/types.gen.js").RequestResult<FindSymbolsResponses, unknown, ThrowOnError, "fields">;
}
declare class File extends _HeyApiClient {
    /**
     * List files and directories
     */
    list<ThrowOnError extends boolean = false>(options: Options<FileListData, ThrowOnError>): import("./client/types.gen.js").RequestResult<FileListResponses, unknown, ThrowOnError, "fields">;
    /**
     * Read a file
     */
    read<ThrowOnError extends boolean = false>(options: Options<FileReadData, ThrowOnError>): import("./client/types.gen.js").RequestResult<FileReadResponses, unknown, ThrowOnError, "fields">;
    /**
     * Get file status
     */
    status<ThrowOnError extends boolean = false>(options?: Options<FileStatusData, ThrowOnError>): import("./client/types.gen.js").RequestResult<FileStatusResponses, unknown, ThrowOnError, "fields">;
}
declare class App extends _HeyApiClient {
    /**
     * Write a log entry to the server logs
     */
    log<ThrowOnError extends boolean = false>(options?: Options<AppLogData, ThrowOnError>): import("./client/types.gen.js").RequestResult<AppLogResponses, AppLogErrors, ThrowOnError, "fields">;
    /**
     * List all agents
     */
    agents<ThrowOnError extends boolean = false>(options?: Options<AppAgentsData, ThrowOnError>): import("./client/types.gen.js").RequestResult<AppAgentsResponses, unknown, ThrowOnError, "fields">;
}
declare class Auth extends _HeyApiClient {
    /**
     * Remove OAuth credentials for an MCP server
     */
    remove<ThrowOnError extends boolean = false>(options: Options<McpAuthRemoveData, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpAuthRemoveResponses, McpAuthRemoveErrors, ThrowOnError, "fields">;
    /**
     * Start OAuth authentication flow for an MCP server
     */
    start<ThrowOnError extends boolean = false>(options: Options<McpAuthStartData, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpAuthStartResponses, McpAuthStartErrors, ThrowOnError, "fields">;
    /**
     * Complete OAuth authentication with authorization code
     */
    callback<ThrowOnError extends boolean = false>(options: Options<McpAuthCallbackData, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpAuthCallbackResponses, McpAuthCallbackErrors, ThrowOnError, "fields">;
    /**
     * Start OAuth flow and wait for callback (opens browser)
     */
    authenticate<ThrowOnError extends boolean = false>(options: Options<McpAuthAuthenticateData, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpAuthAuthenticateResponses, McpAuthAuthenticateErrors, ThrowOnError, "fields">;
    /**
     * Set authentication credentials
     */
    set<ThrowOnError extends boolean = false>(options: Options<AuthSetData, ThrowOnError>): import("./client/types.gen.js").RequestResult<AuthSetResponses, AuthSetErrors, ThrowOnError, "fields">;
}
declare class Mcp extends _HeyApiClient {
    /**
     * Get MCP server status
     */
    status<ThrowOnError extends boolean = false>(options?: Options<McpStatusData, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpStatusResponses, unknown, ThrowOnError, "fields">;
    /**
     * Add MCP server dynamically
     */
    add<ThrowOnError extends boolean = false>(options?: Options<McpAddData, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpAddResponses, McpAddErrors, ThrowOnError, "fields">;
    /**
     * Connect an MCP server
     */
    connect<ThrowOnError extends boolean = false>(options: Options<McpConnectData, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpConnectResponses, unknown, ThrowOnError, "fields">;
    /**
     * Disconnect an MCP server
     */
    disconnect<ThrowOnError extends boolean = false>(options: Options<McpDisconnectData, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpDisconnectResponses, unknown, ThrowOnError, "fields">;
    auth: Auth;
}
declare class Lsp extends _HeyApiClient {
    /**
     * Get LSP server status
     */
    status<ThrowOnError extends boolean = false>(options?: Options<LspStatusData, ThrowOnError>): import("./client/types.gen.js").RequestResult<LspStatusResponses, unknown, ThrowOnError, "fields">;
}
declare class Formatter extends _HeyApiClient {
    /**
     * Get formatter status
     */
    status<ThrowOnError extends boolean = false>(options?: Options<FormatterStatusData, ThrowOnError>): import("./client/types.gen.js").RequestResult<FormatterStatusResponses, unknown, ThrowOnError, "fields">;
}
declare class Control extends _HeyApiClient {
    /**
     * Get the next TUI request from the queue
     */
    next<ThrowOnError extends boolean = false>(options?: Options<TuiControlNextData, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiControlNextResponses, unknown, ThrowOnError, "fields">;
    /**
     * Submit a response to the TUI request queue
     */
    response<ThrowOnError extends boolean = false>(options?: Options<TuiControlResponseData, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiControlResponseResponses, unknown, ThrowOnError, "fields">;
}
declare class Tui extends _HeyApiClient {
    /**
     * Append prompt to the TUI
     */
    appendPrompt<ThrowOnError extends boolean = false>(options?: Options<TuiAppendPromptData, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiAppendPromptResponses, TuiAppendPromptErrors, ThrowOnError, "fields">;
    /**
     * Open the help dialog
     */
    openHelp<ThrowOnError extends boolean = false>(options?: Options<TuiOpenHelpData, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiOpenHelpResponses, unknown, ThrowOnError, "fields">;
    /**
     * Open the session dialog
     */
    openSessions<ThrowOnError extends boolean = false>(options?: Options<TuiOpenSessionsData, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiOpenSessionsResponses, unknown, ThrowOnError, "fields">;
    /**
     * Open the theme dialog
     */
    openThemes<ThrowOnError extends boolean = false>(options?: Options<TuiOpenThemesData, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiOpenThemesResponses, unknown, ThrowOnError, "fields">;
    /**
     * Open the model dialog
     */
    openModels<ThrowOnError extends boolean = false>(options?: Options<TuiOpenModelsData, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiOpenModelsResponses, unknown, ThrowOnError, "fields">;
    /**
     * Submit the prompt
     */
    submitPrompt<ThrowOnError extends boolean = false>(options?: Options<TuiSubmitPromptData, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiSubmitPromptResponses, unknown, ThrowOnError, "fields">;
    /**
     * Clear the prompt
     */
    clearPrompt<ThrowOnError extends boolean = false>(options?: Options<TuiClearPromptData, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiClearPromptResponses, unknown, ThrowOnError, "fields">;
    /**
     * Execute a TUI command (e.g. agent_cycle)
     */
    executeCommand<ThrowOnError extends boolean = false>(options?: Options<TuiExecuteCommandData, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiExecuteCommandResponses, TuiExecuteCommandErrors, ThrowOnError, "fields">;
    /**
     * Show a toast notification in the TUI
     */
    showToast<ThrowOnError extends boolean = false>(options?: Options<TuiShowToastData, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiShowToastResponses, unknown, ThrowOnError, "fields">;
    /**
     * Publish a TUI event
     */
    publish<ThrowOnError extends boolean = false>(options?: Options<TuiPublishData, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiPublishResponses, TuiPublishErrors, ThrowOnError, "fields">;
    control: Control;
}
declare class Event extends _HeyApiClient {
    /**
     * Get events
     */
    subscribe<ThrowOnError extends boolean = false>(options?: Options<EventSubscribeData, ThrowOnError>): Promise<import("./core/serverSentEvents.gen.js").ServerSentEventsResult<EventSubscribeResponses, unknown>>;
}
export declare class OpencodeClient extends _HeyApiClient {
    /**
     * Respond to a permission request
     */
    postSessionIdPermissionsPermissionId<ThrowOnError extends boolean = false>(options: Options<PostSessionIdPermissionsPermissionIdData, ThrowOnError>): import("./client/types.gen.js").RequestResult<PostSessionIdPermissionsPermissionIdResponses, PostSessionIdPermissionsPermissionIdErrors, ThrowOnError, "fields">;
    global: Global;
    project: Project;
    pty: Pty;
    config: Config;
    tool: Tool;
    instance: Instance;
    path: Path;
    vcs: Vcs;
    session: Session;
    command: Command;
    provider: Provider;
    find: Find;
    file: File;
    app: App;
    mcp: Mcp;
    lsp: Lsp;
    formatter: Formatter;
    tui: Tui;
    auth: Auth;
    event: Event;
}
export {};
