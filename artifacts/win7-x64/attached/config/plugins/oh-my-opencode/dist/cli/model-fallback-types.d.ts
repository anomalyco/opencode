import type { FallbackModelObject } from "../config/schema/fallback-models";
export interface ProviderAvailability {
    native: {
        claude: boolean;
        openai: boolean;
        gemini: boolean;
    };
    opencodeZen: boolean;
    copilot: boolean;
    zai: boolean;
    kimiForCoding: boolean;
    opencodeGo: boolean;
    vercelAiGateway: boolean;
    isMaxPlan: boolean;
}
export interface AgentConfig {
    model: string;
    variant?: string;
    fallback_models?: FallbackModelObject[];
}
export interface CategoryConfig {
    model: string;
    variant?: string;
    fallback_models?: FallbackModelObject[];
}
export interface GeneratedOmoConfig {
    $schema: string;
    agents?: Record<string, AgentConfig>;
    categories?: Record<string, CategoryConfig>;
    [key: string]: unknown;
}
