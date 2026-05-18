import { Minimatch } from 'minimatch';
import { Path } from 'path-scurry';
import { GlobWalkerOpts } from './walker.js';
export interface IgnoreLike {
    ignored?: (p: Path) => boolean;
    childrenIgnored?: (p: Path) => boolean;
}
/**
 * Class used to process ignored patterns
 */
export declare class Ignore implements IgnoreLike {
    relative: Minimatch[];
    relativeChildren: Minimatch[];
    absolute: Minimatch[];
    absoluteChildren: Minimatch[];
    constructor(ignored: string[], { nobrace, nocase, noext, noglobstar, platform, }: GlobWalkerOpts);
    ignored(p: Path): boolean;
    childrenIgnored(p: Path): boolean;
}
//# sourceMappingURL=ignore.d.ts.map