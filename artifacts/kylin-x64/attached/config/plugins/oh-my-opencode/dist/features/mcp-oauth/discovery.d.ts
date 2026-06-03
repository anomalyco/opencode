export interface OAuthServerMetadata {
    authorizationEndpoint: string;
    tokenEndpoint: string;
    registrationEndpoint?: string;
    resource: string;
}
export declare function discoverOAuthServerMetadata(resource: string): Promise<OAuthServerMetadata>;
export declare function resetDiscoveryCache(): void;
