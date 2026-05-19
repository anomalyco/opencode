import type { ModelCapabilitiesSnapshot } from "./model-capabilities";
export type ModelCapabilityGuardrailIssue = {
    kind: "alias-target-missing-from-snapshot";
    ruleID: string;
    aliasModelID: string;
    canonicalModelID: string;
    message: string;
} | {
    kind: "exact-alias-collides-with-snapshot";
    ruleID: string;
    aliasModelID: string;
    canonicalModelID: string;
    message: string;
} | {
    kind: "pattern-alias-collides-with-snapshot";
    ruleID: string;
    modelID: string;
    canonicalModelID: string;
    message: string;
} | {
    kind: "built-in-model-relies-on-alias";
    modelID: string;
    canonicalModelID: string;
    ruleID: string;
    message: string;
} | {
    kind: "built-in-model-missing-from-snapshot";
    modelID: string;
    canonicalModelID: string;
    message: string;
};
type CollectModelCapabilityGuardrailIssuesInput = {
    snapshot?: ModelCapabilitiesSnapshot;
    requirementModelIDs?: Iterable<string>;
};
export declare function getBuiltInRequirementModelIDs(): string[];
export declare function collectModelCapabilityGuardrailIssues(input?: CollectModelCapabilityGuardrailIssuesInput): ModelCapabilityGuardrailIssue[];
export {};
