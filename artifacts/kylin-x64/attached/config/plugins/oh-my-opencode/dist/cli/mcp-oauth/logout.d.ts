export interface LogoutOptions {
    serverUrl?: string;
}
export declare function logout(serverName: string, options?: LogoutOptions): Promise<number>;
