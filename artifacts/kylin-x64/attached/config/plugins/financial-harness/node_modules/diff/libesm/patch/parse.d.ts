import type { StructuredPatch } from '../types.js';
/**
 * Parses a patch into structured data, in the same structure returned by `structuredPatch`.
 *
 * @return a JSON object representation of the a patch, suitable for use with the `applyPatch` method.
 */
export declare function parsePatch(uniDiff: string): StructuredPatch[];
//# sourceMappingURL=parse.d.ts.map