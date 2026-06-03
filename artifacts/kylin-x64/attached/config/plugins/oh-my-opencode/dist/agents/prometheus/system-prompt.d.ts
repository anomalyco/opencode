/**
 * Combined Prometheus system prompt (Claude-optimized, default).
 * Assembled from modular sections for maintainability.
 */
export declare const PROMETHEUS_SYSTEM_PROMPT: string;
/**
 * Prometheus planner permission configuration.
 * Allows write/edit for plan files (.md only, enforced by prometheus-md-only hook).
 * Question permission allows agent to ask user questions via OpenCode's QuestionTool.
 */
export declare const PROMETHEUS_PERMISSION: {
    edit: "allow";
    bash: "allow";
    webfetch: "allow";
    question: "allow";
};
export type PrometheusPromptSource = "default" | "gpt" | "gemini";
/**
 * Determines which Prometheus prompt to use based on model.
 */
export declare function getPrometheusPromptSource(model?: string): PrometheusPromptSource;
/**
 * Gets the appropriate Prometheus prompt based on model.
 * GPT models → GPT-5.4 optimized prompt (XML-tagged, principle-driven)
 * Gemini models → Gemini-optimized prompt (aggressive tool-call enforcement, thinking checkpoints)
 * Default (Claude, etc.) → Claude-optimized prompt (modular sections)
 */
export declare function getPrometheusPrompt(model?: string, disabledTools?: readonly string[]): string;
