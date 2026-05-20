export interface ModelMetadata {
    id: string;
    provider?: string;
    context?: number;
    output?: number;
    name?: string;
    variants?: Record<string, unknown>;
    limit?: {
        context?: number;
        input?: number;
        output?: number;
    };
    modalities?: {
        input?: string[];
        output?: string[];
    };
    capabilities?: Record<string, unknown>;
    reasoning?: boolean;
    temperature?: boolean;
    tool_call?: boolean;
    [key: string]: unknown;
}
export interface ProviderModelsCache {
    models: Record<string, string[] | ModelMetadata[]>;
    connected: string[];
    updatedAt: string;
}
export declare function createConnectedProvidersCacheStore(getCacheDir?: () => string): {
    readConnectedProvidersCache: () => string[] | null;
    hasConnectedProvidersCache: () => boolean;
    readProviderModelsCache: () => ProviderModelsCache | null;
    hasProviderModelsCache: () => boolean;
    writeProviderModelsCache: (data: {
        models: Record<string, string[] | ModelMetadata[]>;
        connected: string[];
    }) => void;
    updateConnectedProvidersCache: (client: {
        provider?: {
            list?: () => Promise<{
                data?: {
                    connected?: string[];
                    all?: Array<{
                        id: string;
                        models?: Record<string, unknown>;
                    }>;
                };
            }>;
        };
    }) => Promise<void>;
    _resetMemCacheForTesting: () => void;
};
export declare function findProviderModelMetadata(providerID: string, modelID: string, cache?: ProviderModelsCache | null): ModelMetadata | undefined;
export declare const readConnectedProvidersCache: () => string[] | null, hasConnectedProvidersCache: () => boolean, readProviderModelsCache: () => ProviderModelsCache | null, hasProviderModelsCache: () => boolean, writeProviderModelsCache: (data: {
    models: Record<string, string[] | ModelMetadata[]>;
    connected: string[];
}) => void, updateConnectedProvidersCache: (client: {
    provider?: {
        list?: () => Promise<{
            data?: {
                connected?: string[];
                all?: Array<{
                    id: string;
                    models?: Record<string, unknown>;
                }>;
            };
        }>;
    };
}) => Promise<void>, _resetMemCacheForTesting: () => void;
