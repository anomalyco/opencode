import type { PluginContext, PluginInterface, ToolsRecord } from "./plugin/types";
import type { OhMyOpenCodeConfig } from "./config";
import type { CreatedHooks } from "./create-hooks";
import type { Managers } from "./create-managers";
export declare function createPluginInterface(args: {
    ctx: PluginContext;
    pluginConfig: OhMyOpenCodeConfig;
    firstMessageVariantGate: {
        shouldOverride: (sessionID: string) => boolean;
        markApplied: (sessionID: string) => void;
        markSessionCreated: (sessionInfo: {
            id?: string;
            title?: string;
            parentID?: string;
        } | undefined) => void;
        clear: (sessionID: string) => void;
    };
    managers: Managers;
    hooks: CreatedHooks;
    tools: ToolsRecord;
}): PluginInterface;
