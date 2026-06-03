import { type Client, type Options as Options2, type TDataShape } from "./client/index.js";
import type { AgentPartInput, AppAgentsResponses, AppLogErrors, AppLogResponses, AppSkillsResponses, Auth as Auth3, AuthRemoveErrors, AuthRemoveResponses, AuthSetErrors, AuthSetResponses, CommandListResponses, Config as Config3, ConfigGetResponses, ConfigProvidersResponses, ConfigUpdateErrors, ConfigUpdateResponses, EventSubscribeResponses, EventTuiCommandExecute, EventTuiPromptAppend, EventTuiSessionSelect, EventTuiToastShow, ExperimentalResourceListResponses, ExperimentalSessionListResponses, ExperimentalWorkspaceCreateErrors, ExperimentalWorkspaceCreateResponses, ExperimentalWorkspaceListResponses, ExperimentalWorkspaceRemoveErrors, ExperimentalWorkspaceRemoveResponses, FileListResponses, FilePartInput, FilePartSource, FileReadResponses, FileStatusResponses, FindFilesResponses, FindSymbolsResponses, FindTextResponses, FormatterStatusResponses, GlobalConfigGetResponses, GlobalConfigUpdateErrors, GlobalConfigUpdateResponses, GlobalDisposeResponses, GlobalEventResponses, GlobalHealthResponses, GlobalSyncEventSubscribeResponses, GlobalUpgradeErrors, GlobalUpgradeResponses, InstanceDisposeResponses, LspStatusResponses, McpAddErrors, McpAddResponses, McpAuthAuthenticateErrors, McpAuthAuthenticateResponses, McpAuthCallbackErrors, McpAuthCallbackResponses, McpAuthRemoveErrors, McpAuthRemoveResponses, McpAuthStartErrors, McpAuthStartResponses, McpConnectResponses, McpDisconnectResponses, McpLocalConfig, McpRemoteConfig, McpStatusResponses, OutputFormat, Part as Part2, PartDeleteErrors, PartDeleteResponses, PartUpdateErrors, PartUpdateResponses, PathGetResponses, PermissionListResponses, PermissionReplyErrors, PermissionReplyResponses, PermissionRespondErrors, PermissionRespondResponses, PermissionRuleset, ProjectCurrentResponses, ProjectInitGitResponses, ProjectListResponses, ProjectUpdateErrors, ProjectUpdateResponses, ProviderAuthResponses, ProviderListResponses, ProviderOauthAuthorizeErrors, ProviderOauthAuthorizeResponses, ProviderOauthCallbackErrors, ProviderOauthCallbackResponses, PtyConnectErrors, PtyConnectResponses, PtyCreateErrors, PtyCreateResponses, PtyGetErrors, PtyGetResponses, PtyListResponses, PtyRemoveErrors, PtyRemoveResponses, PtyUpdateErrors, PtyUpdateResponses, QuestionAnswer, QuestionListResponses, QuestionRejectErrors, QuestionRejectResponses, QuestionReplyErrors, QuestionReplyResponses, SessionAbortErrors, SessionAbortResponses, SessionChildrenErrors, SessionChildrenResponses, SessionCommandErrors, SessionCommandResponses, SessionCreateErrors, SessionCreateResponses, SessionDeleteErrors, SessionDeleteMessageErrors, SessionDeleteMessageResponses, SessionDeleteResponses, SessionDiffResponses, SessionForkResponses, SessionGetErrors, SessionGetResponses, SessionInitErrors, SessionInitResponses, SessionListResponses, SessionMessageErrors, SessionMessageResponses, SessionMessagesErrors, SessionMessagesResponses, SessionPromptAsyncErrors, SessionPromptAsyncResponses, SessionPromptErrors, SessionPromptResponses, SessionRevertErrors, SessionRevertResponses, SessionShareErrors, SessionShareResponses, SessionShellErrors, SessionShellResponses, SessionStatusErrors, SessionStatusResponses, SessionSummarizeErrors, SessionSummarizeResponses, SessionTodoErrors, SessionTodoResponses, SessionUnrevertErrors, SessionUnrevertResponses, SessionUnshareErrors, SessionUnshareResponses, SessionUpdateErrors, SessionUpdateResponses, SubtaskPartInput, TextPartInput, ToolIdsErrors, ToolIdsResponses, ToolListErrors, ToolListResponses, TuiAppendPromptErrors, TuiAppendPromptResponses, TuiClearPromptResponses, TuiControlNextResponses, TuiControlResponseResponses, TuiExecuteCommandErrors, TuiExecuteCommandResponses, TuiOpenHelpResponses, TuiOpenModelsResponses, TuiOpenSessionsResponses, TuiOpenThemesResponses, TuiPublishErrors, TuiPublishResponses, TuiSelectSessionErrors, TuiSelectSessionResponses, TuiShowToastResponses, TuiSubmitPromptResponses, VcsGetResponses, WorktreeCreateErrors, WorktreeCreateInput, WorktreeCreateResponses, WorktreeListResponses, WorktreeRemoveErrors, WorktreeRemoveInput, WorktreeRemoveResponses, WorktreeResetErrors, WorktreeResetInput, WorktreeResetResponses } from "./types.gen.js";
export type Options<TData extends TDataShape = TDataShape, ThrowOnError extends boolean = boolean> = Options2<TData, ThrowOnError> & {
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
declare class HeyApiClient {
    protected client: Client;
    constructor(args?: {
        client?: Client;
    });
}
declare class HeyApiRegistry<T> {
    private readonly defaultKey;
    private readonly instances;
    get(key?: string): T;
    set(value: T, key?: string): void;
}
export declare class SyncEvent extends HeyApiClient {
    /**
     * Subscribe to global sync events
     *
     * Get global sync events
     */
    subscribe<ThrowOnError extends boolean = false>(options?: Options<never, ThrowOnError>): Promise<import("./core/serverSentEvents.gen.js").ServerSentEventsResult<GlobalSyncEventSubscribeResponses, unknown>>;
}
export declare class Config extends HeyApiClient {
    /**
     * Get global configuration
     *
     * Retrieve the current global OpenCode configuration settings and preferences.
     */
    get<ThrowOnError extends boolean = false>(options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<GlobalConfigGetResponses, unknown, ThrowOnError, "fields">;
    /**
     * Update global configuration
     *
     * Update global OpenCode configuration settings and preferences.
     */
    update<ThrowOnError extends boolean = false>(parameters?: {
        config?: Config3;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<GlobalConfigUpdateResponses, GlobalConfigUpdateErrors, ThrowOnError, "fields">;
}
export declare class Global extends HeyApiClient {
    /**
     * Get health
     *
     * Get health information about the OpenCode server.
     */
    health<ThrowOnError extends boolean = false>(options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<GlobalHealthResponses, unknown, ThrowOnError, "fields">;
    /**
     * Get global events
     *
     * Subscribe to global events from the OpenCode system using server-sent events.
     */
    event<ThrowOnError extends boolean = false>(options?: Options<never, ThrowOnError>): Promise<import("./core/serverSentEvents.gen.js").ServerSentEventsResult<GlobalEventResponses, unknown>>;
    /**
     * Dispose instance
     *
     * Clean up and dispose all OpenCode instances, releasing all resources.
     */
    dispose<ThrowOnError extends boolean = false>(options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<GlobalDisposeResponses, unknown, ThrowOnError, "fields">;
    /**
     * Upgrade opencode
     *
     * Upgrade opencode to the specified version or latest if not specified.
     */
    upgrade<ThrowOnError extends boolean = false>(parameters?: {
        target?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<GlobalUpgradeResponses, GlobalUpgradeErrors, ThrowOnError, "fields">;
    private _syncEvent?;
    get syncEvent(): SyncEvent;
    private _config?;
    get config(): Config;
}
export declare class Auth extends HeyApiClient {
    /**
     * Remove auth credentials
     *
     * Remove authentication credentials
     */
    remove<ThrowOnError extends boolean = false>(parameters: {
        providerID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<AuthRemoveResponses, AuthRemoveErrors, ThrowOnError, "fields">;
    /**
     * Set auth credentials
     *
     * Set authentication credentials
     */
    set<ThrowOnError extends boolean = false>(parameters: {
        providerID: string;
        auth?: Auth3;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<AuthSetResponses, AuthSetErrors, ThrowOnError, "fields">;
}
export declare class App extends HeyApiClient {
    /**
     * Write log
     *
     * Write a log entry to the server logs with specified level and metadata.
     */
    log<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        service?: string;
        level?: "debug" | "info" | "error" | "warn";
        message?: string;
        extra?: {
            [key: string]: unknown;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<AppLogResponses, AppLogErrors, ThrowOnError, "fields">;
    /**
     * List agents
     *
     * Get a list of all available AI agents in the OpenCode system.
     */
    agents<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<AppAgentsResponses, unknown, ThrowOnError, "fields">;
    /**
     * List skills
     *
     * Get a list of all available skills in the OpenCode system.
     */
    skills<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<AppSkillsResponses, unknown, ThrowOnError, "fields">;
}
export declare class Project extends HeyApiClient {
    /**
     * List all projects
     *
     * Get a list of projects that have been opened with OpenCode.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProjectListResponses, unknown, ThrowOnError, "fields">;
    /**
     * Get current project
     *
     * Retrieve the currently active project that OpenCode is working with.
     */
    current<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProjectCurrentResponses, unknown, ThrowOnError, "fields">;
    /**
     * Initialize git repository
     *
     * Create a git repository for the current project and return the refreshed project info.
     */
    initGit<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProjectInitGitResponses, unknown, ThrowOnError, "fields">;
    /**
     * Update project
     *
     * Update project properties such as name, icon, and commands.
     */
    update<ThrowOnError extends boolean = false>(parameters: {
        projectID: string;
        directory?: string;
        workspace?: string;
        name?: string;
        icon?: {
            url?: string;
            override?: string;
            color?: string;
        };
        commands?: {
            /**
             * Startup script to run when creating a new workspace (worktree)
             */
            start?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProjectUpdateResponses, ProjectUpdateErrors, ThrowOnError, "fields">;
}
export declare class Pty extends HeyApiClient {
    /**
     * List PTY sessions
     *
     * Get a list of all active pseudo-terminal (PTY) sessions managed by OpenCode.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyListResponses, unknown, ThrowOnError, "fields">;
    /**
     * Create PTY session
     *
     * Create a new pseudo-terminal (PTY) session for running shell commands and processes.
     */
    create<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        command?: string;
        args?: Array<string>;
        cwd?: string;
        title?: string;
        env?: {
            [key: string]: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyCreateResponses, PtyCreateErrors, ThrowOnError, "fields">;
    /**
     * Remove PTY session
     *
     * Remove and terminate a specific pseudo-terminal (PTY) session.
     */
    remove<ThrowOnError extends boolean = false>(parameters: {
        ptyID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyRemoveResponses, PtyRemoveErrors, ThrowOnError, "fields">;
    /**
     * Get PTY session
     *
     * Retrieve detailed information about a specific pseudo-terminal (PTY) session.
     */
    get<ThrowOnError extends boolean = false>(parameters: {
        ptyID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyGetResponses, PtyGetErrors, ThrowOnError, "fields">;
    /**
     * Update PTY session
     *
     * Update properties of an existing pseudo-terminal (PTY) session.
     */
    update<ThrowOnError extends boolean = false>(parameters: {
        ptyID: string;
        directory?: string;
        workspace?: string;
        title?: string;
        size?: {
            rows: number;
            cols: number;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyUpdateResponses, PtyUpdateErrors, ThrowOnError, "fields">;
    /**
     * Connect to PTY session
     *
     * Establish a WebSocket connection to interact with a pseudo-terminal (PTY) session in real-time.
     */
    connect<ThrowOnError extends boolean = false>(parameters: {
        ptyID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyConnectResponses, PtyConnectErrors, ThrowOnError, "fields">;
}
export declare class Config2 extends HeyApiClient {
    /**
     * Get configuration
     *
     * Retrieve the current OpenCode configuration settings and preferences.
     */
    get<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigGetResponses, unknown, ThrowOnError, "fields">;
    /**
     * Update configuration
     *
     * Update OpenCode configuration settings and preferences.
     */
    update<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        config?: Config3;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigUpdateResponses, ConfigUpdateErrors, ThrowOnError, "fields">;
    /**
     * List config providers
     *
     * Get a list of all configured AI providers and their default models.
     */
    providers<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigProvidersResponses, unknown, ThrowOnError, "fields">;
}
export declare class Tool extends HeyApiClient {
    /**
     * List tool IDs
     *
     * Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.
     */
    ids<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ToolIdsResponses, ToolIdsErrors, ThrowOnError, "fields">;
    /**
     * List tools
     *
     * Get a list of available tools with their JSON schema parameters for a specific provider and model combination.
     */
    list<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        provider: string;
        model: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ToolListResponses, ToolListErrors, ThrowOnError, "fields">;
}
export declare class Workspace extends HeyApiClient {
    /**
     * List workspaces
     *
     * List all workspaces.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalWorkspaceListResponses, unknown, ThrowOnError, "fields">;
    /**
     * Create workspace
     *
     * Create a workspace for the current project.
     */
    create<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        id?: string;
        type?: string;
        branch?: string | null;
        extra?: unknown | null;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalWorkspaceCreateResponses, ExperimentalWorkspaceCreateErrors, ThrowOnError, "fields">;
    /**
     * Remove workspace
     *
     * Remove an existing workspace.
     */
    remove<ThrowOnError extends boolean = false>(parameters: {
        id: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalWorkspaceRemoveResponses, ExperimentalWorkspaceRemoveErrors, ThrowOnError, "fields">;
}
export declare class Session extends HeyApiClient {
    /**
     * List sessions
     *
     * Get a list of all OpenCode sessions across projects, sorted by most recently updated. Archived sessions are excluded by default.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        roots?: boolean;
        start?: number;
        cursor?: number;
        search?: string;
        limit?: number;
        archived?: boolean;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalSessionListResponses, unknown, ThrowOnError, "fields">;
}
export declare class Resource extends HeyApiClient {
    /**
     * Get MCP resources
     *
     * Get all available MCP resources from connected servers. Optionally filter by name.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalResourceListResponses, unknown, ThrowOnError, "fields">;
}
export declare class Experimental extends HeyApiClient {
    private _workspace?;
    get workspace(): Workspace;
    private _session?;
    get session(): Session;
    private _resource?;
    get resource(): Resource;
}
export declare class Worktree extends HeyApiClient {
    /**
     * Remove worktree
     *
     * Remove a git worktree and delete its branch.
     */
    remove<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        worktreeRemoveInput?: WorktreeRemoveInput;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<WorktreeRemoveResponses, WorktreeRemoveErrors, ThrowOnError, "fields">;
    /**
     * List worktrees
     *
     * List all sandbox worktrees for the current project.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<WorktreeListResponses, unknown, ThrowOnError, "fields">;
    /**
     * Create worktree
     *
     * Create a new git worktree for the current project and run any configured startup scripts.
     */
    create<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        worktreeCreateInput?: WorktreeCreateInput;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<WorktreeCreateResponses, WorktreeCreateErrors, ThrowOnError, "fields">;
    /**
     * Reset worktree
     *
     * Reset a worktree branch to the primary default branch.
     */
    reset<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        worktreeResetInput?: WorktreeResetInput;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<WorktreeResetResponses, WorktreeResetErrors, ThrowOnError, "fields">;
}
export declare class Session2 extends HeyApiClient {
    /**
     * List sessions
     *
     * Get a list of all OpenCode sessions, sorted by most recently updated.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        roots?: boolean;
        start?: number;
        search?: string;
        limit?: number;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionListResponses, unknown, ThrowOnError, "fields">;
    /**
     * Create session
     *
     * Create a new OpenCode session for interacting with AI assistants and managing conversations.
     */
    create<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        parentID?: string;
        title?: string;
        permission?: PermissionRuleset;
        workspaceID?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionCreateResponses, SessionCreateErrors, ThrowOnError, "fields">;
    /**
     * Get session status
     *
     * Retrieve the current status of all sessions, including active, idle, and completed states.
     */
    status<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionStatusResponses, SessionStatusErrors, ThrowOnError, "fields">;
    /**
     * Delete session
     *
     * Delete a session and permanently remove all associated data, including messages and history.
     */
    delete<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionDeleteResponses, SessionDeleteErrors, ThrowOnError, "fields">;
    /**
     * Get session
     *
     * Retrieve detailed information about a specific OpenCode session.
     */
    get<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionGetResponses, SessionGetErrors, ThrowOnError, "fields">;
    /**
     * Update session
     *
     * Update properties of an existing session, such as title or other metadata.
     */
    update<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        title?: string;
        time?: {
            archived?: number;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionUpdateResponses, SessionUpdateErrors, ThrowOnError, "fields">;
    /**
     * Get session children
     *
     * Retrieve all child sessions that were forked from the specified parent session.
     */
    children<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionChildrenResponses, SessionChildrenErrors, ThrowOnError, "fields">;
    /**
     * Get session todos
     *
     * Retrieve the todo list associated with a specific session, showing tasks and action items.
     */
    todo<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionTodoResponses, SessionTodoErrors, ThrowOnError, "fields">;
    /**
     * Initialize session
     *
     * Analyze the current application and create an AGENTS.md file with project-specific agent configurations.
     */
    init<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        modelID?: string;
        providerID?: string;
        messageID?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionInitResponses, SessionInitErrors, ThrowOnError, "fields">;
    /**
     * Fork session
     *
     * Create a new session by forking an existing session at a specific message point.
     */
    fork<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        messageID?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionForkResponses, unknown, ThrowOnError, "fields">;
    /**
     * Abort session
     *
     * Abort an active session and stop any ongoing AI processing or command execution.
     */
    abort<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionAbortResponses, SessionAbortErrors, ThrowOnError, "fields">;
    /**
     * Unshare session
     *
     * Remove the shareable link for a session, making it private again.
     */
    unshare<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionUnshareResponses, SessionUnshareErrors, ThrowOnError, "fields">;
    /**
     * Share session
     *
     * Create a shareable link for a session, allowing others to view the conversation.
     */
    share<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionShareResponses, SessionShareErrors, ThrowOnError, "fields">;
    /**
     * Get message diff
     *
     * Get the file changes (diff) that resulted from a specific user message in the session.
     */
    diff<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        messageID?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionDiffResponses, unknown, ThrowOnError, "fields">;
    /**
     * Summarize session
     *
     * Generate a concise summary of the session using AI compaction to preserve key information.
     */
    summarize<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        providerID?: string;
        modelID?: string;
        auto?: boolean;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionSummarizeResponses, SessionSummarizeErrors, ThrowOnError, "fields">;
    /**
     * Get session messages
     *
     * Retrieve all messages in a session, including user prompts and AI responses.
     */
    messages<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        limit?: number;
        before?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionMessagesResponses, SessionMessagesErrors, ThrowOnError, "fields">;
    /**
     * Send message
     *
     * Create and send a new message to a session, streaming the AI response.
     */
    prompt<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        messageID?: string;
        model?: {
            providerID: string;
            modelID: string;
        };
        agent?: string;
        noReply?: boolean;
        tools?: {
            [key: string]: boolean;
        };
        format?: OutputFormat;
        system?: string;
        variant?: string;
        parts?: Array<TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput>;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionPromptResponses, SessionPromptErrors, ThrowOnError, "fields">;
    /**
     * Delete message
     *
     * Permanently delete a specific message (and all of its parts) from a session. This does not revert any file changes that may have been made while processing the message.
     */
    deleteMessage<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        messageID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionDeleteMessageResponses, SessionDeleteMessageErrors, ThrowOnError, "fields">;
    /**
     * Get message
     *
     * Retrieve a specific message from a session by its message ID.
     */
    message<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        messageID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionMessageResponses, SessionMessageErrors, ThrowOnError, "fields">;
    /**
     * Send async message
     *
     * Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.
     */
    promptAsync<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        messageID?: string;
        model?: {
            providerID: string;
            modelID: string;
        };
        agent?: string;
        noReply?: boolean;
        tools?: {
            [key: string]: boolean;
        };
        format?: OutputFormat;
        system?: string;
        variant?: string;
        parts?: Array<TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput>;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionPromptAsyncResponses, SessionPromptAsyncErrors, ThrowOnError, "fields">;
    /**
     * Send command
     *
     * Send a new command to a session for execution by the AI assistant.
     */
    command<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        messageID?: string;
        agent?: string;
        model?: string;
        arguments?: string;
        command?: string;
        variant?: string;
        parts?: Array<{
            id?: string;
            type: "file";
            mime: string;
            filename?: string;
            url: string;
            source?: FilePartSource;
        }>;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionCommandResponses, SessionCommandErrors, ThrowOnError, "fields">;
    /**
     * Run shell command
     *
     * Execute a shell command within the session context and return the AI's response.
     */
    shell<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        agent?: string;
        model?: {
            providerID: string;
            modelID: string;
        };
        command?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionShellResponses, SessionShellErrors, ThrowOnError, "fields">;
    /**
     * Revert message
     *
     * Revert a specific message in a session, undoing its effects and restoring the previous state.
     */
    revert<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        messageID?: string;
        partID?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionRevertResponses, SessionRevertErrors, ThrowOnError, "fields">;
    /**
     * Restore reverted messages
     *
     * Restore all previously reverted messages in a session.
     */
    unrevert<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionUnrevertResponses, SessionUnrevertErrors, ThrowOnError, "fields">;
}
export declare class Part extends HeyApiClient {
    /**
     * Delete a part from a message
     */
    delete<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        messageID: string;
        partID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PartDeleteResponses, PartDeleteErrors, ThrowOnError, "fields">;
    /**
     * Update a part in a message
     */
    update<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        messageID: string;
        partID: string;
        directory?: string;
        workspace?: string;
        part?: Part2;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PartUpdateResponses, PartUpdateErrors, ThrowOnError, "fields">;
}
export declare class Permission extends HeyApiClient {
    /**
     * Respond to permission
     *
     * Approve or deny a permission request from the AI assistant.
     *
     * @deprecated
     */
    respond<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        permissionID: string;
        directory?: string;
        workspace?: string;
        response?: "once" | "always" | "reject";
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PermissionRespondResponses, PermissionRespondErrors, ThrowOnError, "fields">;
    /**
     * Respond to permission request
     *
     * Approve or deny a permission request from the AI assistant.
     */
    reply<ThrowOnError extends boolean = false>(parameters: {
        requestID: string;
        directory?: string;
        workspace?: string;
        reply?: "once" | "always" | "reject";
        message?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PermissionReplyResponses, PermissionReplyErrors, ThrowOnError, "fields">;
    /**
     * List pending permissions
     *
     * Get all pending permission requests across all sessions.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PermissionListResponses, unknown, ThrowOnError, "fields">;
}
export declare class Question extends HeyApiClient {
    /**
     * List pending questions
     *
     * Get all pending question requests across all sessions.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<QuestionListResponses, unknown, ThrowOnError, "fields">;
    /**
     * Reply to question request
     *
     * Provide answers to a question request from the AI assistant.
     */
    reply<ThrowOnError extends boolean = false>(parameters: {
        requestID: string;
        directory?: string;
        workspace?: string;
        answers?: Array<QuestionAnswer>;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<QuestionReplyResponses, QuestionReplyErrors, ThrowOnError, "fields">;
    /**
     * Reject question request
     *
     * Reject a question request from the AI assistant.
     */
    reject<ThrowOnError extends boolean = false>(parameters: {
        requestID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<QuestionRejectResponses, QuestionRejectErrors, ThrowOnError, "fields">;
}
export declare class Oauth extends HeyApiClient {
    /**
     * OAuth authorize
     *
     * Initiate OAuth authorization for a specific AI provider to get an authorization URL.
     */
    authorize<ThrowOnError extends boolean = false>(parameters: {
        providerID: string;
        directory?: string;
        workspace?: string;
        method?: number;
        inputs?: {
            [key: string]: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProviderOauthAuthorizeResponses, ProviderOauthAuthorizeErrors, ThrowOnError, "fields">;
    /**
     * OAuth callback
     *
     * Handle the OAuth callback from a provider after user authorization.
     */
    callback<ThrowOnError extends boolean = false>(parameters: {
        providerID: string;
        directory?: string;
        workspace?: string;
        method?: number;
        code?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProviderOauthCallbackResponses, ProviderOauthCallbackErrors, ThrowOnError, "fields">;
}
export declare class Provider extends HeyApiClient {
    /**
     * List providers
     *
     * Get a list of all available AI providers, including both available and connected ones.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProviderListResponses, unknown, ThrowOnError, "fields">;
    /**
     * Get provider auth methods
     *
     * Retrieve available authentication methods for all AI providers.
     */
    auth<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProviderAuthResponses, unknown, ThrowOnError, "fields">;
    private _oauth?;
    get oauth(): Oauth;
}
export declare class Find extends HeyApiClient {
    /**
     * Find text
     *
     * Search for text patterns across files in the project using ripgrep.
     */
    text<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        pattern: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<FindTextResponses, unknown, ThrowOnError, "fields">;
    /**
     * Find files
     *
     * Search for files or directories by name or pattern in the project directory.
     */
    files<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        query: string;
        dirs?: "true" | "false";
        type?: "file" | "directory";
        limit?: number;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<FindFilesResponses, unknown, ThrowOnError, "fields">;
    /**
     * Find symbols
     *
     * Search for workspace symbols like functions, classes, and variables using LSP.
     */
    symbols<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        query: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<FindSymbolsResponses, unknown, ThrowOnError, "fields">;
}
export declare class File extends HeyApiClient {
    /**
     * List files
     *
     * List files and directories in a specified path.
     */
    list<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        path: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<FileListResponses, unknown, ThrowOnError, "fields">;
    /**
     * Read file
     *
     * Read the content of a specified file.
     */
    read<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        path: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<FileReadResponses, unknown, ThrowOnError, "fields">;
    /**
     * Get file status
     *
     * Get the git status of all files in the project.
     */
    status<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<FileStatusResponses, unknown, ThrowOnError, "fields">;
}
export declare class Event extends HeyApiClient {
    /**
     * Subscribe to events
     *
     * Get events
     */
    subscribe<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): Promise<import("./core/serverSentEvents.gen.js").ServerSentEventsResult<EventSubscribeResponses, unknown>>;
}
export declare class Auth2 extends HeyApiClient {
    /**
     * Remove MCP OAuth
     *
     * Remove OAuth credentials for an MCP server
     */
    remove<ThrowOnError extends boolean = false>(parameters: {
        name: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpAuthRemoveResponses, McpAuthRemoveErrors, ThrowOnError, "fields">;
    /**
     * Start MCP OAuth
     *
     * Start OAuth authentication flow for a Model Context Protocol (MCP) server.
     */
    start<ThrowOnError extends boolean = false>(parameters: {
        name: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpAuthStartResponses, McpAuthStartErrors, ThrowOnError, "fields">;
    /**
     * Complete MCP OAuth
     *
     * Complete OAuth authentication for a Model Context Protocol (MCP) server using the authorization code.
     */
    callback<ThrowOnError extends boolean = false>(parameters: {
        name: string;
        directory?: string;
        workspace?: string;
        code?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpAuthCallbackResponses, McpAuthCallbackErrors, ThrowOnError, "fields">;
    /**
     * Authenticate MCP OAuth
     *
     * Start OAuth flow and wait for callback (opens browser)
     */
    authenticate<ThrowOnError extends boolean = false>(parameters: {
        name: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpAuthAuthenticateResponses, McpAuthAuthenticateErrors, ThrowOnError, "fields">;
}
export declare class Mcp extends HeyApiClient {
    /**
     * Get MCP status
     *
     * Get the status of all Model Context Protocol (MCP) servers.
     */
    status<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpStatusResponses, unknown, ThrowOnError, "fields">;
    /**
     * Add MCP server
     *
     * Dynamically add a new Model Context Protocol (MCP) server to the system.
     */
    add<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        name?: string;
        config?: McpLocalConfig | McpRemoteConfig;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpAddResponses, McpAddErrors, ThrowOnError, "fields">;
    /**
     * Connect an MCP server
     */
    connect<ThrowOnError extends boolean = false>(parameters: {
        name: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpConnectResponses, unknown, ThrowOnError, "fields">;
    /**
     * Disconnect an MCP server
     */
    disconnect<ThrowOnError extends boolean = false>(parameters: {
        name: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpDisconnectResponses, unknown, ThrowOnError, "fields">;
    private _auth?;
    get auth(): Auth2;
}
export declare class Control extends HeyApiClient {
    /**
     * Get next TUI request
     *
     * Retrieve the next TUI (Terminal User Interface) request from the queue for processing.
     */
    next<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiControlNextResponses, unknown, ThrowOnError, "fields">;
    /**
     * Submit TUI response
     *
     * Submit a response to the TUI request queue to complete a pending request.
     */
    response<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        body?: unknown;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiControlResponseResponses, unknown, ThrowOnError, "fields">;
}
export declare class Tui extends HeyApiClient {
    /**
     * Append TUI prompt
     *
     * Append prompt to the TUI
     */
    appendPrompt<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        text?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiAppendPromptResponses, TuiAppendPromptErrors, ThrowOnError, "fields">;
    /**
     * Open help dialog
     *
     * Open the help dialog in the TUI to display user assistance information.
     */
    openHelp<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiOpenHelpResponses, unknown, ThrowOnError, "fields">;
    /**
     * Open sessions dialog
     *
     * Open the session dialog
     */
    openSessions<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiOpenSessionsResponses, unknown, ThrowOnError, "fields">;
    /**
     * Open themes dialog
     *
     * Open the theme dialog
     */
    openThemes<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiOpenThemesResponses, unknown, ThrowOnError, "fields">;
    /**
     * Open models dialog
     *
     * Open the model dialog
     */
    openModels<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiOpenModelsResponses, unknown, ThrowOnError, "fields">;
    /**
     * Submit TUI prompt
     *
     * Submit the prompt
     */
    submitPrompt<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiSubmitPromptResponses, unknown, ThrowOnError, "fields">;
    /**
     * Clear TUI prompt
     *
     * Clear the prompt
     */
    clearPrompt<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiClearPromptResponses, unknown, ThrowOnError, "fields">;
    /**
     * Execute TUI command
     *
     * Execute a TUI command (e.g. agent_cycle)
     */
    executeCommand<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        command?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiExecuteCommandResponses, TuiExecuteCommandErrors, ThrowOnError, "fields">;
    /**
     * Show TUI toast
     *
     * Show a toast notification in the TUI
     */
    showToast<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        title?: string;
        message?: string;
        variant?: "info" | "success" | "warning" | "error";
        duration?: number;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiShowToastResponses, unknown, ThrowOnError, "fields">;
    /**
     * Publish TUI event
     *
     * Publish a TUI event
     */
    publish<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        body?: EventTuiPromptAppend | EventTuiCommandExecute | EventTuiToastShow | EventTuiSessionSelect;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiPublishResponses, TuiPublishErrors, ThrowOnError, "fields">;
    /**
     * Select session
     *
     * Navigate the TUI to display the specified session.
     */
    selectSession<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        sessionID?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiSelectSessionResponses, TuiSelectSessionErrors, ThrowOnError, "fields">;
    private _control?;
    get control(): Control;
}
export declare class Instance extends HeyApiClient {
    /**
     * Dispose instance
     *
     * Clean up and dispose the current OpenCode instance, releasing all resources.
     */
    dispose<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<InstanceDisposeResponses, unknown, ThrowOnError, "fields">;
}
export declare class Path extends HeyApiClient {
    /**
     * Get paths
     *
     * Retrieve the current working directory and related path information for the OpenCode instance.
     */
    get<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PathGetResponses, unknown, ThrowOnError, "fields">;
}
export declare class Vcs extends HeyApiClient {
    /**
     * Get VCS info
     *
     * Retrieve version control system (VCS) information for the current project, such as git branch.
     */
    get<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<VcsGetResponses, unknown, ThrowOnError, "fields">;
}
export declare class Command extends HeyApiClient {
    /**
     * List commands
     *
     * Get a list of all available commands in the OpenCode system.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<CommandListResponses, unknown, ThrowOnError, "fields">;
}
export declare class Lsp extends HeyApiClient {
    /**
     * Get LSP status
     *
     * Get LSP server status
     */
    status<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<LspStatusResponses, unknown, ThrowOnError, "fields">;
}
export declare class Formatter extends HeyApiClient {
    /**
     * Get formatter status
     *
     * Get formatter status
     */
    status<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<FormatterStatusResponses, unknown, ThrowOnError, "fields">;
}
export declare class OpencodeClient extends HeyApiClient {
    static readonly __registry: HeyApiRegistry<OpencodeClient>;
    constructor(args?: {
        client?: Client;
        key?: string;
    });
    private _global?;
    get global(): Global;
    private _auth?;
    get auth(): Auth;
    private _app?;
    get app(): App;
    private _project?;
    get project(): Project;
    private _pty?;
    get pty(): Pty;
    private _config?;
    get config(): Config2;
    private _tool?;
    get tool(): Tool;
    private _experimental?;
    get experimental(): Experimental;
    private _worktree?;
    get worktree(): Worktree;
    private _session?;
    get session(): Session2;
    private _part?;
    get part(): Part;
    private _permission?;
    get permission(): Permission;
    private _question?;
    get question(): Question;
    private _provider?;
    get provider(): Provider;
    private _find?;
    get find(): Find;
    private _file?;
    get file(): File;
    private _event?;
    get event(): Event;
    private _mcp?;
    get mcp(): Mcp;
    private _tui?;
    get tui(): Tui;
    private _instance?;
    get instance(): Instance;
    private _path?;
    get path(): Path;
    private _vcs?;
    get vcs(): Vcs;
    private _command?;
    get command(): Command;
    private _lsp?;
    get lsp(): Lsp;
    private _formatter?;
    get formatter(): Formatter;
}
export {};
