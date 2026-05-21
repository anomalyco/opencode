export type AuthToken = string | undefined;
export interface Auth {
    /**
     * Which part of the request do we use to send the auth?
     *
     * @default 'header'
     */
    in?: "header" | "query" | "cookie";
    /**
     * Header or query parameter name.
     *
     * @default 'Authorization'
     */
    name?: string;
    scheme?: "basic" | "bearer";
    type: "apiKey" | "http";
}
export declare const getAuthToken: (auth: Auth, callback: ((auth: Auth) => Promise<AuthToken> | AuthToken) | AuthToken) => Promise<string | undefined>;
