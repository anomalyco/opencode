import type { OhMyOpenCodeConfig } from "../../config";
import type { FallbackModelObject } from "../../config/schema/fallback-models";
/**
 * Returns fallback model strings for the runtime-fallback system.
 * Object entries are flattened to "provider/model(variant)" strings so the
 * string-based fallback state machine can work with them unchanged.
 */
export declare function getFallbackModelsForSession(sessionID: string, agent: string | undefined, pluginConfig: OhMyOpenCodeConfig | undefined): string[];
/**
 * Returns the raw fallback model entries (strings and objects) for a session.
 * Use this when per-model settings (temperature, reasoningEffort, etc.) must be
 * preserved - e.g. before passing to buildFallbackChainFromModels.
 */
export declare function getRawFallbackModels(sessionID: string, agent: string | undefined, pluginConfig: OhMyOpenCodeConfig | undefined): (string | FallbackModelObject)[] | undefined;
