export declare const QuestionRoutes: {
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
        "/:requestID/reply": {
            $post: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                } & {
                    json: {
                        answers: string[][];
                    };
                };
                output: true;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:requestID/reject": {
            $post: {
                input: {
                    param: {
                        [x: string]: any;
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
