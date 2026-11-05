import type { StructuredPatch } from '../types.js';
/**
 * Parses a unified diff format patch into a structured patch object.
 *
 * `parsePatch` has some understanding of Git's particular dialect of unified diff format.
 * When parsing a Git patch, each index in the result may contain additional
 * fields (`isRename`, `isBinary`, etc) not included in the data structure returned by
 * `structuredPatch`; see the `StructuredPatch` interface for a full list.
 *
 * @return a JSON object representation of the patch, suitable for use with the `applyPatch`
 * method. This parses to the same structure returned by `structuredPatch`, except that
 * `oldFileName` and `newFileName` may be `undefined` if the patch doesn't contain enough
 * information to determine them (e.g. a hunk-only patch with no file headers).
 */
export declare function parsePatch(uniDiff: string): StructuredPatch[];
//# sourceMappingURL=parse.d.ts.map