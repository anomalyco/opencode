import type { WebsearchConfig } from "../config/schema";
type RemoteMcpConfig = {
    type: "remote";
    url: string;
    enabled: boolean;
    headers?: Record<string, string>;
    oauth?: false;
};
export declare function createWebsearchConfig(config?: WebsearchConfig): RemoteMcpConfig | undefined;
export declare const websearch: RemoteMcpConfig | undefined;
export {};
