export declare const ProjectRoutes: {
    (): import("hono/hono-base").HonoBase<import("hono/types").BlankEnv, {
        "/": {
            $get: {
                input: {};
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/current": {
            $get: {
                input: {};
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/create": {
            $post: {
                input: {
                    json: {
                        name: string;
                    };
                };
                output: {
                    error: string;
                };
                outputFormat: "json";
                status: 401;
            } | {
                input: {
                    json: {
                        name: string;
                    };
                };
                output: {
                    project: any;
                };
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    }, "/">;
    reset: () => void;
};
