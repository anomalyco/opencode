import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpClient, McpTransport, SkillMcpClientConnectionParams } from "./types";
type StdioClientFactory = (clientInfo: {
    name: string;
    version: string;
}, options: {
    capabilities: Record<string, never>;
}) => McpClient;
type StdioTransportFactory = (options: ConstructorParameters<typeof StdioClientTransport>[0]) => McpTransport;
interface StdioClientDependencies {
    createClient: StdioClientFactory;
    createTransport: StdioTransportFactory;
}
export declare function setStdioClientDependenciesForTesting(dependencies?: Partial<StdioClientDependencies>): void;
export declare function createStdioClient(params: SkillMcpClientConnectionParams): Promise<McpClient>;
export {};
