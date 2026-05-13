export declare const SYMBOLS: {
    readonly check: string;
    readonly cross: string;
    readonly warn: string;
    readonly info: string;
    readonly arrow: string;
    readonly bullet: string;
    readonly skip: string;
};
export declare const STATUS_COLORS: {
    readonly pass: import("picocolors/types").Formatter;
    readonly fail: import("picocolors/types").Formatter;
    readonly warn: import("picocolors/types").Formatter;
    readonly skip: import("picocolors/types").Formatter;
};
export declare const CHECK_IDS: {
    readonly SYSTEM: "system";
    readonly CONFIG: "config";
    readonly TOOLS: "tools";
    readonly MODELS: "models";
};
export declare const CHECK_NAMES: Record<string, string>;
export declare const EXIT_CODES: {
    readonly SUCCESS: 0;
    readonly FAILURE: 1;
};
export declare const MIN_OPENCODE_VERSION = "1.4.0";
export declare const PACKAGE_NAME = "oh-my-opencode";
export declare const OPENCODE_BINARIES: readonly ["opencode", "opencode-desktop"];
