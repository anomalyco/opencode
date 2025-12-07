export type MatchResult<T> =
	| { success: true; match: T }
	| { success: false; error: "ambiguous"; matches: T[] }
	| { success: false; error: "not-found"; available: T[] };

export function fuzzyMatch<T>(
	query: string,
	items: T[],
	getName: (item: T) => string,
): MatchResult<T> {
	const normalizedQuery = query.trim().toLowerCase();

	if (!normalizedQuery) {
		return { success: false, error: "not-found", available: items };
	}

	// Try exact match first (case-insensitive)
	const exactMatch = items.find(
		(item) => getName(item).toLowerCase() === normalizedQuery,
	);
	if (exactMatch) {
		return { success: true, match: exactMatch };
	}

	// Try fuzzy substring match (case-insensitive)
	const fuzzyMatches = items.filter((item) =>
		getName(item).toLowerCase().includes(normalizedQuery),
	);

	if (fuzzyMatches.length === 0) {
		return { success: false, error: "not-found", available: items };
	}

	if (fuzzyMatches.length === 1) {
		return { success: true, match: fuzzyMatches[0] };
	}

	return { success: false, error: "ambiguous", matches: fuzzyMatches };
}
