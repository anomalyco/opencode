import type { ModelCapabilitiesSnapshot } from "./model-capabilities";
export declare const MODELS_DEV_SOURCE_URL = "https://models.dev/api.json";
export declare function buildModelCapabilitiesSnapshotFromModelsDev(raw: unknown): ModelCapabilitiesSnapshot;
export declare function fetchModelCapabilitiesSnapshot(args?: {
    sourceUrl?: string;
    fetchImpl?: typeof fetch;
}): Promise<ModelCapabilitiesSnapshot>;
export declare function createModelCapabilitiesCacheStore(getCacheDir?: () => string): {
    readModelCapabilitiesCache: () => ModelCapabilitiesSnapshot | null;
    hasModelCapabilitiesCache: () => boolean;
    writeModelCapabilitiesCache: (snapshot: ModelCapabilitiesSnapshot) => void;
    refreshModelCapabilitiesCache: (args?: {
        sourceUrl?: string;
        fetchImpl?: typeof fetch;
    }) => Promise<ModelCapabilitiesSnapshot>;
};
export declare const readModelCapabilitiesCache: () => ModelCapabilitiesSnapshot | null, hasModelCapabilitiesCache: () => boolean, writeModelCapabilitiesCache: (snapshot: ModelCapabilitiesSnapshot) => void, refreshModelCapabilitiesCache: (args?: {
    sourceUrl?: string;
    fetchImpl?: typeof fetch;
}) => Promise<ModelCapabilitiesSnapshot>;
