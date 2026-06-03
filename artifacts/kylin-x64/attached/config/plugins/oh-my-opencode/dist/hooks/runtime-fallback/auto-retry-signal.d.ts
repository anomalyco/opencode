export interface AutoRetrySignal {
    signal: string;
}
export declare function extractAutoRetrySignal(info: Record<string, unknown> | undefined): AutoRetrySignal | undefined;
