export declare const McpRoutes: {
    (): import("hono/hono-base").HonoBase<import("hono/types").BlankEnv, {
        "/": {
            $get: {
                input: {};
                output: {
                    [x: string]: {
                        status: "connected";
                    } | {
                        status: "disabled";
                    } | {
                        status: "failed";
                        error: string;
                    } | {
                        status: "needs_auth";
                    } | {
                        status: "needs_client_registration";
                        error: string;
                    };
                };
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/": {
            $post: {
                input: {
                    json: {
                        name: string;
                        config: {
                            type: "local";
                            command: string[];
                            environment?: Record<string, string> | undefined;
                            enabled?: boolean | undefined;
                            timeout?: number | undefined;
                        } | {
                            type: "remote";
                            url: string;
                            enabled?: boolean | undefined;
                            headers?: Record<string, string> | undefined;
                            oauth?: false | {
                                clientId?: string | undefined;
                                clientSecret?: string | undefined;
                                scope?: string | undefined;
                            } | undefined;
                            timeout?: number | undefined;
                        };
                    };
                };
                output: {
                    [x: string]: {
                        status: "connected";
                    } | {
                        status: "disabled";
                    } | {
                        status: "failed";
                        error: string;
                    } | {
                        status: "needs_auth";
                    } | {
                        status: "needs_client_registration";
                        error: string;
                    };
                } | {
                    status: "failed";
                    error: string;
                };
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:name/auth": {
            $post: {
                input: {
                    param: {
                        name: string;
                    };
                };
                output: {
                    error: string;
                };
                outputFormat: "json";
                status: 400;
            } | {
                input: {
                    param: {
                        name: string;
                    };
                };
                output: {
                    authorizationUrl: string;
                };
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:name/auth/callback": {
            $post: {
                input: {
                    json: {
                        code: string;
                    };
                } & {
                    param: {
                        name: string;
                    };
                };
                output: {
                    status: "connected";
                } | {
                    status: "disabled";
                } | {
                    status: "failed";
                    error: string;
                } | {
                    status: "needs_auth";
                } | {
                    status: "needs_client_registration";
                    error: string;
                };
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:name/auth/authenticate": {
            $post: {
                input: {
                    param: {
                        name: string;
                    };
                };
                output: {
                    error: string;
                };
                outputFormat: "json";
                status: 400;
            } | {
                input: {
                    param: {
                        name: string;
                    };
                };
                output: {
                    status: "connected";
                } | {
                    status: "disabled";
                } | {
                    status: "failed";
                    error: string;
                } | {
                    status: "needs_auth";
                } | {
                    status: "needs_client_registration";
                    error: string;
                };
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:name/auth": {
            $delete: {
                input: {
                    param: {
                        name: string;
                    };
                };
                output: {
                    success: true;
                };
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:name/connect": {
            $post: {
                input: {
                    param: {
                        name: string;
                    };
                };
                output: true;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:name/disconnect": {
            $post: {
                input: {
                    param: {
                        name: string;
                    };
                };
                output: true;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    }, "/">;
    reset: () => void;
};
