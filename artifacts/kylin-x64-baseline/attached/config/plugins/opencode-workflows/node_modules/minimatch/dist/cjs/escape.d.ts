import { MinimatchOptions } from './index.js';
/**
 * Escape all magic characters in a glob pattern.
 *
 * If the {@link windowsPathsNoEscape | GlobOptions.windowsPathsNoEscape}
 * option is used, then characters are escaped by wrapping in `[]`, because
 * a magic character wrapped in a character class can only be satisfied by
 * that exact character.  In this mode, `\` is _not_ escaped, because it is
 * not interpreted as a magic character, but instead as a path separator.
 */
export declare const escape: (s: string, { windowsPathsNoEscape, }?: Pick<MinimatchOptions, 'windowsPathsNoEscape'>) => string;
//# sourceMappingURL=escape.d.ts.map