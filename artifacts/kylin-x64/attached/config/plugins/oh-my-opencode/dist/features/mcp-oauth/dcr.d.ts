export type ClientRegistrationRequest = {
    redirect_uris: string[];
    client_name: string;
    grant_types: ["authorization_code", "refresh_token"];
    response_types: ["code"];
    token_endpoint_auth_method: "none" | "client_secret_post";
};
export type ClientCredentials = {
    clientId: string;
    clientSecret?: string;
};
export type ClientRegistrationStorage = {
    getClientRegistration: (serverIdentifier: string) => ClientCredentials | null;
    setClientRegistration: (serverIdentifier: string, credentials: ClientCredentials) => void;
};
export type DynamicClientRegistrationOptions = {
    registrationEndpoint?: string | null;
    serverIdentifier?: string;
    clientName: string;
    redirectUris: string[];
    tokenEndpointAuthMethod: "none" | "client_secret_post";
    clientId?: string | null;
    storage: ClientRegistrationStorage;
    fetch?: DcrFetch;
};
export type DcrFetch = (input: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}) => Promise<{
    ok: boolean;
    json: () => Promise<unknown>;
}>;
export declare function getOrRegisterClient(options: DynamicClientRegistrationOptions): Promise<ClientCredentials | null>;
