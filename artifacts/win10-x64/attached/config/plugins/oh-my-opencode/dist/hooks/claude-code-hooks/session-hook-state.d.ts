export declare const sessionFirstMessageProcessed: Set<string>;
export declare const sessionErrorState: Map<string, {
    hasError: boolean;
    errorMessage?: string;
}>;
export declare const sessionInterruptState: Map<string, {
    interrupted: boolean;
}>;
export declare function clearSessionHookState(sessionID: string): void;
export declare function clearAllSessionHookState(): void;
