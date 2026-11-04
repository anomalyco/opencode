import type { StructuredPatch } from '../types.js';
/**
 * Returns a new structured patch which when applied will undo the original `patch`.
 *
 * When `patch` is a Git-style patch, `reversePatch` handles extended header information (relating
 * to renames, file modes, etc.) to the extent that doing so is possible, but note one fundamental
 * limitation: the correct inverse of a patch featuring `copy from`/`copy to` headers cannot, in
 * general, be determined based on the information contained in the patch alone, and so
 * `reversePatch`'s output when passed such a patch will usually be rejected by `git apply`. (The
 * correct inverse would be a patch that deletes the newly-created file, but for Git to apply such
 * a patch, the patch must explicitly delete every line of content in the file too, and that
 * content cannot be determined from the original patch on its own. `reversePatch` therefore does
 * the only vaguely reasonable thing it can do in this scenario: it outputs a patch with a
 * `deleted file mode` header - indicating that the file should be deleted - but no hunks.)
 *
 * @param patch either a single structured patch object (as returned by `structuredPatch`) or an
 *   array of them (as returned by `parsePatch`).
 */
export declare function reversePatch(structuredPatch: StructuredPatch): StructuredPatch;
export declare function reversePatch(structuredPatch: StructuredPatch[]): StructuredPatch[];
export declare function reversePatch(structuredPatch: StructuredPatch | StructuredPatch[]): StructuredPatch | StructuredPatch[];
//# sourceMappingURL=reverse.d.ts.map