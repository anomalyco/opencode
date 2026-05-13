import type { BackgroundManager } from "../../features/background-agent";
import type { CompactionContextClient, CompactionContextInjector } from "./types";
export declare function createCompactionContextInjector(options?: {
    ctx?: CompactionContextClient;
    backgroundManager?: BackgroundManager;
}): CompactionContextInjector;
