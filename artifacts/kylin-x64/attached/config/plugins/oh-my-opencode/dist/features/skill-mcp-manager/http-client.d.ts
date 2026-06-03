import type { McpClient, McpTransport, SkillMcpClientConnectionParams } from "./types";
type HttpClientFactory = (clientInfo: {
    name: string;
    version: string;
}, options: {
    capabilities: Record<string, never>;
}) => McpClient;
type HttpTransportFactory = (url: URL, options?: {
    requestInit?: RequestInit;
}) => McpTransport;
interface HttpClientDependencies {
    createClient: HttpClientFactory;
    createTransport: HttpTransportFactory;
}
export declare function setHttpClientDependenciesForTesting(dependencies?: Partial<HttpClientDependencies>): void;
export declare function createHttpClient(params: SkillMcpClientConnectionParams): Promise<McpClient>;
export {};
