declare const DEFAULT_SERVER_PORT = 4096;
export declare function isPortAvailable(port: number, hostname?: string): Promise<boolean>;
export declare function findAvailablePort(startPort?: number, hostname?: string): Promise<number>;
export interface AutoPortResult {
    port: number;
    wasAutoSelected: boolean;
}
export declare function getAvailableServerPort(preferredPort?: number, hostname?: string): Promise<AutoPortResult>;
export { DEFAULT_SERVER_PORT };
