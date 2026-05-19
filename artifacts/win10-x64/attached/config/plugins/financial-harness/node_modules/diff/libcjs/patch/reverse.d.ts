import type { StructuredPatch } from '../types.js';
/**
 * @param patch either a single structured patch object (as returned by `structuredPatch`) or an array of them (as returned by `parsePatch`).
 * @returns a new structured patch which when applied will undo the original `patch`.
 */
export declare function reversePatch(structuredPatch: StructuredPatch): StructuredPatch;
export declare function reversePatch(structuredPatch: StructuredPatch[]): StructuredPatch[];
export declare function reversePatch(structuredPatch: StructuredPatch | StructuredPatch[]): StructuredPatch | StructuredPatch[];
//# sourceMappingURL=reverse.d.ts.map