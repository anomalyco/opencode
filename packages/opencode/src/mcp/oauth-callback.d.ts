export declare namespace McpOAuthCallback {
    function ensureRunning(): Promise<void>;
    function waitForCallback(oauthState: string): Promise<string>;
    function cancelPending(mcpName: string): void;
    function isPortInUse(): Promise<boolean>;
    function stop(): Promise<void>;
    function isRunning(): boolean;
}
