declare const _default: {
    (p: string, pattern: string, options?: import("./index.js").MinimatchOptions): boolean;
    sep: "\\" | "/";
    GLOBSTAR: typeof import("./index.js").GLOBSTAR;
    filter: (pattern: string, options?: import("./index.js").MinimatchOptions) => (p: string) => boolean;
    defaults: (def: import("./index.js").MinimatchOptions) => any;
    braceExpand: (pattern: string, options?: import("./index.js").MinimatchOptions) => string[];
    makeRe: (pattern: string, options?: import("./index.js").MinimatchOptions) => false | import("./index.js").MMRegExp;
    match: (list: string[], pattern: string, options?: import("./index.js").MinimatchOptions) => string[];
    AST: typeof import("./ast.js").AST;
    Minimatch: typeof import("./index.js").Minimatch;
    escape: (s: string, { windowsPathsNoEscape, }?: Pick<import("./index.js").MinimatchOptions, "windowsPathsNoEscape">) => string;
    unescape: (s: string, { windowsPathsNoEscape, }?: Pick<import("./index.js").MinimatchOptions, "windowsPathsNoEscape">) => string;
} & {
    default: {
        (p: string, pattern: string, options?: import("./index.js").MinimatchOptions): boolean;
        sep: "\\" | "/";
        GLOBSTAR: typeof import("./index.js").GLOBSTAR;
        filter: (pattern: string, options?: import("./index.js").MinimatchOptions) => (p: string) => boolean;
        defaults: (def: import("./index.js").MinimatchOptions) => any;
        braceExpand: (pattern: string, options?: import("./index.js").MinimatchOptions) => string[];
        makeRe: (pattern: string, options?: import("./index.js").MinimatchOptions) => false | import("./index.js").MMRegExp;
        match: (list: string[], pattern: string, options?: import("./index.js").MinimatchOptions) => string[];
        AST: typeof import("./ast.js").AST;
        Minimatch: typeof import("./index.js").Minimatch;
        escape: (s: string, { windowsPathsNoEscape, }?: Pick<import("./index.js").MinimatchOptions, "windowsPathsNoEscape">) => string;
        unescape: (s: string, { windowsPathsNoEscape, }?: Pick<import("./index.js").MinimatchOptions, "windowsPathsNoEscape">) => string;
    };
    minimatch: {
        (p: string, pattern: string, options?: import("./index.js").MinimatchOptions): boolean;
        sep: "\\" | "/";
        GLOBSTAR: typeof import("./index.js").GLOBSTAR;
        filter: (pattern: string, options?: import("./index.js").MinimatchOptions) => (p: string) => boolean;
        defaults: (def: import("./index.js").MinimatchOptions) => any;
        braceExpand: (pattern: string, options?: import("./index.js").MinimatchOptions) => string[];
        makeRe: (pattern: string, options?: import("./index.js").MinimatchOptions) => false | import("./index.js").MMRegExp;
        match: (list: string[], pattern: string, options?: import("./index.js").MinimatchOptions) => string[];
        AST: typeof import("./ast.js").AST;
        Minimatch: typeof import("./index.js").Minimatch;
        escape: (s: string, { windowsPathsNoEscape, }?: Pick<import("./index.js").MinimatchOptions, "windowsPathsNoEscape">) => string;
        unescape: (s: string, { windowsPathsNoEscape, }?: Pick<import("./index.js").MinimatchOptions, "windowsPathsNoEscape">) => string;
    };
};
export = _default;
//# sourceMappingURL=index-cjs.d.ts.map