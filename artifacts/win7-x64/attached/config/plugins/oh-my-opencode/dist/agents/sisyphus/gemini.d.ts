/**
 * Gemini-specific overlay sections for Sisyphus prompt.
 *
 * Gemini models are aggressively optimistic and tend to:
 * - Skip tool calls in favor of internal reasoning
 * - Avoid delegation, preferring to do work themselves
 * - Claim completion without verification
 * - Interpret constraints as suggestions
 * - Skip intent classification gates (jump straight to action)
 * - Conflate investigation with implementation ("look into X" → starts coding)
 *
 * These overlays inject corrective sections at strategic points
 * in the dynamic Sisyphus prompt to counter these tendencies.
 */
export declare function buildGeminiToolMandate(): string;
export declare function buildGeminiToolGuide(): string;
export declare function buildGeminiToolCallExamples(): string;
export declare function buildGeminiDelegationOverride(): string;
export declare function buildGeminiVerificationOverride(): string;
export declare function buildGeminiIntentGateEnforcement(): string;
