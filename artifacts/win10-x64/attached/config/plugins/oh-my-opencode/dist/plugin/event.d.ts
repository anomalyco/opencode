import type { OhMyOpenCodeConfig } from "../config";
import type { PluginContext } from "./types";
import type { CreatedHooks } from "../create-hooks";
import type { Managers } from "../create-managers";
type FirstMessageVariantGate = {
    markSessionCreated: (sessionInfo: {
        id?: string;
        title?: string;
        parentID?: string;
    } | undefined) => void;
    clear: (sessionID: string) => void;
};
type EventInput = Parameters<NonNullable<NonNullable<CreatedHooks["writeExistingFileGuard"]>["event"]>>[0];
export declare function createEventHandler(args: {
    ctx: PluginContext;
    pluginConfig: OhMyOpenCodeConfig;
    firstMessageVariantGate: FirstMessageVariantGate;
    managers: Managers;
    hooks: CreatedHooks;
}): (input: EventInput) => Promise<void>;
export {};
