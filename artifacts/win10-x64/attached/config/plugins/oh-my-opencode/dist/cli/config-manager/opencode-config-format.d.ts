export type ConfigFormat = "json" | "jsonc" | "none";
export declare function detectConfigFormat(): {
    format: ConfigFormat;
    path: string;
};
