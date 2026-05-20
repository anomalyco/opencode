export type WebFetchFormat = "markdown" | "text" | "html";
type RedirectResolutionParams = {
    url: string;
    format: WebFetchFormat;
    timeoutSeconds?: number;
};
export type RedirectResolutionResult = {
    type: "resolved";
    url: string;
} | {
    type: "exceeded";
    url: string;
    maxRedirects: number;
};
export declare function resolveWebFetchRedirects(params: RedirectResolutionParams): Promise<RedirectResolutionResult>;
export {};
