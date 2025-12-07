import type { ModelInfo } from "@agentclientprotocol/sdk"
import type { MatchResult } from "../util/match.js"
import { fuzzyMatch } from "../util/match.js"

/**
 * Match a model name or ID against available models.
 * First tries to match by modelId, then falls back to matching by name.
 */
export function matchModel(
	requested: string,
	availableModels: ModelInfo[],
): MatchResult<ModelInfo> {
	// Try matching by modelId first
	const modelIdResult = fuzzyMatch(requested, availableModels, (m) => m.modelId)
	if (modelIdResult.success) {
		return modelIdResult
	}

	// If not found by modelId, try matching by name
	const nameResult = fuzzyMatch(requested, availableModels, (m) => m.name)
	if (nameResult.success) {
		return nameResult
	}

	// If both failed, check if either returned an ambiguous error
	// Prioritize showing modelId ambiguity over name ambiguity
	if (!modelIdResult.success && modelIdResult.error === "ambiguous") {
		return modelIdResult
	}

	if (!nameResult.success && nameResult.error === "ambiguous") {
		return nameResult
	}

	// Both returned not-found, return the modelId result (with full available list)
	return modelIdResult
}
