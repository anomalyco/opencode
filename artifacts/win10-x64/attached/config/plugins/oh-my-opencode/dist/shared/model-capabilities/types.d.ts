import type { ModelMetadata } from "../connected-providers-cache";
export type ModelCapabilitiesSnapshotEntry = {
    id: string;
    family?: string;
    reasoning?: boolean;
    temperature?: boolean;
    toolCall?: boolean;
    modalities?: {
        input?: string[];
        output?: string[];
    };
    limit?: {
        context?: number;
        input?: number;
        output?: number;
    };
};
export type ModelCapabilitiesSnapshot = {
    generatedAt: string;
    sourceUrl: string;
    models: Record<string, ModelCapabilitiesSnapshotEntry>;
};
export type ModelCapabilitiesDiagnostics = {
    resolutionMode: "snapshot-backed" | "alias-backed" | "heuristic-backed" | "unknown";
    canonicalization: {
        source: "canonical" | "exact-alias" | "pattern-alias";
        ruleID?: string;
    };
    snapshot: {
        source: "runtime-snapshot" | "bundled-snapshot" | "none";
    };
    family: {
        source: "snapshot" | "heuristic" | "none";
    };
    variants: {
        source: "none" | "runtime" | "override" | "heuristic" | "canonical";
    };
    reasoningEfforts: {
        source: "none" | "override" | "heuristic";
    };
    reasoning: {
        source: "runtime" | "runtime-snapshot" | "bundled-snapshot" | "none";
    };
    supportsThinking: {
        source: "runtime" | "override" | "heuristic" | "runtime-snapshot" | "bundled-snapshot" | "none";
    };
    supportsTemperature: {
        source: "runtime" | "override" | "runtime-snapshot" | "bundled-snapshot" | "none";
    };
    supportsTopP: {
        source: "runtime" | "override" | "none";
    };
    maxOutputTokens: {
        source: "runtime" | "runtime-snapshot" | "bundled-snapshot" | "none";
    };
    toolCall: {
        source: "runtime" | "runtime-snapshot" | "bundled-snapshot" | "none";
    };
    modalities: {
        source: "runtime" | "runtime-snapshot" | "bundled-snapshot" | "none";
    };
};
export type ModelCapabilities = {
    requestedModelID: string;
    canonicalModelID: string;
    family?: string;
    variants?: string[];
    reasoningEfforts?: string[];
    reasoning?: boolean;
    supportsThinking?: boolean;
    supportsTemperature?: boolean;
    supportsTopP?: boolean;
    maxOutputTokens?: number;
    toolCall?: boolean;
    modalities?: {
        input?: string[];
        output?: string[];
    };
    diagnostics: ModelCapabilitiesDiagnostics;
};
export type GetModelCapabilitiesInput = {
    providerID: string;
    modelID: string;
    runtimeModel?: ModelMetadata | Record<string, unknown>;
    runtimeSnapshot?: ModelCapabilitiesSnapshot;
    bundledSnapshot?: ModelCapabilitiesSnapshot;
};
export type ModelCapabilityOverride = {
    variants?: string[];
    reasoningEfforts?: string[];
    supportsThinking?: boolean;
    supportsTemperature?: boolean;
    supportsTopP?: boolean;
};
