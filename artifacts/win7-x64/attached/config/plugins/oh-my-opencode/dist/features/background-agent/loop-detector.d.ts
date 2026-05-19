import type { BackgroundTaskConfig } from "../../config/schema";
import type { ToolCallWindow } from "./types";
export interface CircuitBreakerSettings {
    enabled: boolean;
    maxToolCalls: number;
    consecutiveThreshold: number;
}
export interface ToolLoopDetectionResult {
    triggered: boolean;
    toolName?: string;
    repeatedCount?: number;
}
export declare function resolveCircuitBreakerSettings(config?: BackgroundTaskConfig): CircuitBreakerSettings;
export declare function recordToolCall(window: ToolCallWindow | undefined, toolName: string, settings: CircuitBreakerSettings, toolInput?: Record<string, unknown> | null): ToolCallWindow;
export declare function createToolCallSignature(toolName: string, toolInput?: Record<string, unknown> | null): string;
export declare function detectRepetitiveToolUse(window: ToolCallWindow | undefined): ToolLoopDetectionResult;
