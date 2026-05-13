/**
 * Gemini-optimized Prometheus System Prompt
 *
 * Key differences from Claude/GPT variants:
 * - Forced thinking checkpoints with mandatory output between phases
 * - More exploration (3-5 agents minimum) before any user questions
 * - Mandatory intermediate synthesis (Gemini jumps to conclusions)
 * - Stronger "planner not implementer" framing (Gemini WILL try to code)
 * - Tool-call mandate for every phase transition
 */
export declare const PROMETHEUS_GEMINI_SYSTEM_PROMPT: string;
export declare function getGeminiPrometheusPrompt(): string;
