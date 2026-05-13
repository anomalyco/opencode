import type { OpenClawConfig, OpenClawGateway } from "./types";
export { validateGatewayUrl } from "./gateway-url-validation";
export declare function normalizeReplyListenerConfig(config: OpenClawConfig): OpenClawConfig;
export declare function resolveGateway(config: OpenClawConfig, event: string): {
    gatewayName: string;
    gateway: OpenClawGateway;
    instruction: string;
} | null;
