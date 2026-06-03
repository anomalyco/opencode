export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function isAbortedSessionError(error: unknown): boolean;
export declare function getErrorText(error: unknown): string;
export declare function extractErrorName(error: unknown): string | undefined;
export declare function extractErrorMessage(error: unknown): string | undefined;
interface EventPropertiesLike {
    [key: string]: unknown;
}
export declare function getSessionErrorMessage(properties: EventPropertiesLike): string | undefined;
export {};
