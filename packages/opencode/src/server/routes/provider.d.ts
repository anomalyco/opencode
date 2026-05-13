export declare const ProviderRoutes: {
    (): import("hono/hono-base").HonoBase<import("hono/types").BlankEnv, {
        "/": {
            $get: {
                input: {};
                output: {
                    all: {
                        id: string;
                        name: string;
                        source: "api" | "config" | "custom" | "env";
                        env: string[];
                        key?: string | undefined;
                        options: {
                            [x: string]: any;
                        };
                        models: {
                            [x: string]: {
                                id: string;
                                providerID: string;
                                api: {
                                    id: string;
                                    url: string;
                                    npm: string;
                                };
                                name: string;
                                family?: string | undefined;
                                capabilities: {
                                    temperature: boolean;
                                    reasoning: boolean;
                                    attachment: boolean;
                                    toolcall: boolean;
                                    input: {
                                        text: boolean;
                                        audio: boolean;
                                        image: boolean;
                                        video: boolean;
                                        pdf: boolean;
                                    };
                                    output: {
                                        text: boolean;
                                        audio: boolean;
                                        image: boolean;
                                        video: boolean;
                                        pdf: boolean;
                                    };
                                    interleaved: boolean | {
                                        field: "reasoning_content" | "reasoning_details";
                                    };
                                };
                                cost: {
                                    input: number;
                                    output: number;
                                    cache: {
                                        read: number;
                                        write: number;
                                    };
                                    experimentalOver200K?: {
                                        input: number;
                                        output: number;
                                        cache: {
                                            read: number;
                                            write: number;
                                        };
                                    } | undefined;
                                };
                                limit: {
                                    context: number;
                                    input?: number | undefined;
                                    output: number;
                                };
                                status: "active" | "alpha" | "beta" | "deprecated";
                                options: {
                                    [x: string]: any;
                                };
                                headers: {
                                    [x: string]: string;
                                };
                                release_date: string;
                                variants?: {
                                    [x: string]: {
                                        [x: string]: any;
                                    };
                                } | undefined;
                            };
                        };
                    }[];
                    default: {
                        [x: string]: string;
                    };
                    connected: string[];
                };
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/auth": {
            $get: {
                input: {};
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:providerID/oauth/authorize": {
            $post: {
                input: {
                    param: {
                        providerID: string;
                    };
                } & {
                    json: {
                        method: number;
                    };
                };
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:providerID/oauth/callback": {
            $post: {
                input: {
                    param: {
                        providerID: string;
                    };
                } & {
                    json: {
                        method: number;
                        code?: string | undefined;
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
