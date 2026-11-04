import type { StructuredPatch } from '../types.js';
export declare function unixToWin(patch: StructuredPatch): StructuredPatch;
export declare function unixToWin(patches: StructuredPatch[]): StructuredPatch[];
export declare function unixToWin(patch: StructuredPatch | StructuredPatch[]): StructuredPatch | StructuredPatch[];
export declare function winToUnix(patch: StructuredPatch): StructuredPatch;
export declare function winToUnix(patches: StructuredPatch[]): StructuredPatch[];
export declare function winToUnix(patch: StructuredPatch | StructuredPatch[]): StructuredPatch | StructuredPatch[];
/**
 * Returns true if the patch consistently uses Unix line endings (or only involves one line and has
 * no line endings).
 */
export declare function isUnix(patch: StructuredPatch | StructuredPatch[]): boolean;
/**
 * Returns true if the patch uses Windows line endings and only Windows line endings.
 */
export declare function isWin(patch: StructuredPatch | StructuredPatch[]): boolean;
//# sourceMappingURL=line-endings.d.ts.map