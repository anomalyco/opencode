export declare const PermissionRoutes: {
    (): import("hono/hono-base").HonoBase<import("hono/types").BlankEnv, {
        "/:requestID/reply": {
            $post: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                } & {
                    json: {
                        [x: string]: any;
                        message?: string | undefined;
                    };
                };
                output: true;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/": {
            $get: {
                input: {};
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    }, "/">;
    reset: () => void;
};
