import { MinimatchOptions, MMRegExp } from './index.js';
export type ExtglobType = '!' | '?' | '+' | '*' | '@';
export declare class AST {
    #private;
    type: ExtglobType | null;
    constructor(type: ExtglobType | null, parent?: AST, options?: MinimatchOptions);
    get hasMagic(): boolean | undefined;
    toString(): string;
    push(...parts: (string | AST)[]): void;
    toJSON(): any[];
    isStart(): boolean;
    isEnd(): boolean;
    copyIn(part: AST | string): void;
    clone(parent: AST): AST;
    static fromGlob(pattern: string, options?: MinimatchOptions): AST;
    toMMPattern(): MMRegExp | string;
    get options(): MinimatchOptions;
    toRegExpSource(): [
        re: string,
        body: string,
        hasMagic: boolean,
        uflag: boolean
    ];
}
//# sourceMappingURL=ast.d.ts.map