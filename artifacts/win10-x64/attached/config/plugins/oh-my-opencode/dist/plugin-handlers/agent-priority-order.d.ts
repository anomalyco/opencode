/**
 * CRITICAL: This is the ONLY source of truth for core agent ordering.
 * The order is: sisyphus → hephaestus → prometheus → atlas
 *
 * DO NOT CHANGE THIS ORDER. Any PR attempting to modify this order
 * or introduce alternative ordering mechanisms (ZWSP prefixes, sort
 * shims, etc.) will be rejected.
 *
 * See: src/plugin-handlers/AGENTS.md for architectural context.
 */
export declare const CANONICAL_CORE_AGENT_ORDER: readonly ["sisyphus", "hephaestus", "prometheus", "atlas"];
export declare function reorderAgentsByPriority(agents: Record<string, unknown>): Record<string, unknown>;
