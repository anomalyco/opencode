export type OAuthCallbackResult = {
    code: string;
    state: string;
};
export type CallbackServer = {
    port: number;
    waitForCallback: () => Promise<OAuthCallbackResult>;
    close: () => void;
};
export declare function findAvailablePort(startPort?: number): Promise<number>;
export declare function startCallbackServer(startPort?: number): Promise<CallbackServer>;
