import type { PluginInput } from "@opencode-ai/plugin";
import type { BackgroundManager } from "../../features/background-agent";
import type { CategoriesConfig, GitMasterConfig, BrowserAutomationProvider, AgentOverrides, SisyphusAgentConfig } from "../../config/schema";
import type { AvailableCategory, AvailableSkill } from "../../agents/dynamic-agent-prompt-builder";
export type OpencodeClient = PluginInput["client"];
export interface DelegateTaskArgs {
    description: string;
    prompt: string;
    category?: string;
    subagent_type?: string;
    run_in_background: boolean;
    task_id?: string;
    command?: string;
    load_skills: string[];
    execute?: {
        task_id: string;
        task_dir?: string;
    };
}
export interface ToolContextWithMetadata {
    sessionID: string;
    messageID: string;
    agent: string;
    abort: AbortSignal;
    metadata?: (input: {
        title?: string;
        metadata?: Record<string, unknown>;
    }) => void | Promise<void>;
    /**
     * Tool call ID injected by OpenCode's internal context (not in plugin ToolContext type,
     * but present at runtime via spread in fromPlugin()). Used for metadata store keying.
     */
    callID?: string;
    /** @deprecated OpenCode internal naming may vary across versions */
    callId?: string;
    /** @deprecated OpenCode internal naming may vary across versions */
    call_id?: string;
}
export interface SyncSessionCreatedEvent {
    sessionID: string;
    parentID: string;
    title: string;
}
export interface DelegateTaskToolOptions {
    manager: BackgroundManager;
    client: OpencodeClient;
    directory: string;
    /**
     * Test hook: bypass global cache reads (Bun runs tests in parallel).
     * If provided, resolveCategoryExecution/resolveSubagentExecution uses this instead of reading from disk cache.
     */
    connectedProvidersOverride?: string[] | null;
    /**
     * Test hook: bypass fetchAvailableModels() by providing an explicit available model set.
     */
    availableModelsOverride?: Set<string>;
    userCategories?: CategoriesConfig;
    gitMasterConfig?: GitMasterConfig;
    sisyphusJuniorModel?: string;
    browserProvider?: BrowserAutomationProvider;
    disabledSkills?: Set<string>;
    availableCategories?: AvailableCategory[];
    availableSkills?: AvailableSkill[];
    agentOverrides?: AgentOverrides;
    sisyphusAgentConfig?: SisyphusAgentConfig;
    onSyncSessionCreated?: (event: SyncSessionCreatedEvent) => Promise<void>;
    syncPollTimeoutMs?: number;
}
import type { DelegatedModelConfig } from "../../shared/model-resolution-types";
export type { DelegatedModelConfig };
export interface BuildSystemContentInput {
    skillContent?: string;
    skillContents?: string[];
    categoryPromptAppend?: string;
    agentsContext?: string;
    planAgentPrepend?: string;
    maxPromptTokens?: number;
    model?: DelegatedModelConfig;
    agentName?: string;
    availableCategories?: AvailableCategory[];
    availableSkills?: AvailableSkill[];
}
