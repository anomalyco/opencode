export declare const SessionRoutes: {
    (): import("hono/hono-base").HonoBase<import("hono/types").BlankEnv, {
        "/": {
            $get: {
                input: {
                    query: {
                        roots?: string | string[] | undefined;
                        start?: string | string[] | undefined;
                        search?: string | string[] | undefined;
                        limit?: string | string[] | undefined;
                    };
                };
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/status": {
            $get: {
                input: {};
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID": {
            $get: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                };
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID/children": {
            $get: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                };
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID/todo": {
            $get: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                };
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/": {
            $post: {
                input: any;
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID": {
            $delete: {
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
    } & {
        "/:sessionID": {
            $patch: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                } & {
                    json: {
                        title?: string | undefined;
                        time?: {
                            archived?: number | undefined;
                        } | undefined;
                    };
                };
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID/pyodide_result": {
            $post: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                } & {
                    json: {
                        callID: string;
                        ok: boolean;
                        output?: string | undefined;
                        exitCode?: number | undefined;
                    };
                };
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID/init": {
            $post: {
                input: any;
                output: true;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID/fork": {
            $post: {
                input: any;
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID/abort": {
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
    } & {
        "/:sessionID/share": {
            $post: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                };
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID/diff": {
            $get: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                } & {
                    query: {
                        [x: string]: any;
                    };
                };
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID/share": {
            $delete: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                };
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID/summarize": {
            $post: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                } & {
                    json: {
                        providerID: string;
                        modelID: string;
                        auto?: boolean | undefined;
                    };
                };
                output: true;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID/message": {
            $get: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                } & {
                    query: {
                        limit?: string | string[] | undefined;
                    };
                };
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID/message/:messageID": {
            $get: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                };
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID/message/:messageID": {
            $delete: {
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
    } & {
        "/:sessionID/message/:messageID/part/:partID": {
            $delete: {
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
    } & {
        "/:sessionID/message/:messageID/part/:partID": {
            $patch: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                } & {
                    json: {
                        [x: string]: any;
                        type: "file";
                        mime: string;
                        filename?: string | undefined;
                        url: string;
                        source?: {
                            text: {
                                value: string;
                                start: number;
                                end: number;
                            };
                            type: "file";
                            path: string;
                        } | {
                            text: {
                                value: string;
                                start: number;
                                end: number;
                            };
                            type: "symbol";
                            path: string;
                            range: {
                                start: {
                                    line: number;
                                    character: number;
                                };
                                end: {
                                    line: number;
                                    character: number;
                                };
                            };
                            name: string;
                            kind: number;
                        } | {
                            text: {
                                value: string;
                                start: number;
                                end: number;
                            };
                            type: "resource";
                            clientName: string;
                            uri: string;
                        } | undefined;
                    } | {
                        [x: string]: any;
                        type: "text";
                        text: string;
                        synthetic?: boolean | undefined;
                        ignored?: boolean | undefined;
                        time?: {
                            start: number;
                            end?: number | undefined;
                        } | undefined;
                        metadata?: Record<string, any> | undefined;
                    } | {
                        [x: string]: any;
                        type: "subtask";
                        prompt: string;
                        description: string;
                        agent: string;
                        model?: {
                            providerID: string;
                            modelID: string;
                        } | undefined;
                        command?: string | undefined;
                    } | {
                        [x: string]: any;
                        type: "reasoning";
                        text: string;
                        metadata?: Record<string, any> | undefined;
                        time: {
                            start: number;
                            end?: number | undefined;
                        };
                    } | {
                        [x: string]: any;
                        type: "tool";
                        callID: string;
                        tool: string;
                        state: {
                            status: "pending";
                            input: Record<string, any>;
                            raw: string;
                        } | {
                            status: "running";
                            input: Record<string, any>;
                            title?: string | undefined;
                            metadata?: Record<string, any> | undefined;
                            time: {
                                start: number;
                            };
                        } | {
                            status: "completed";
                            input: Record<string, any>;
                            output: string;
                            title: string;
                            metadata: Record<string, any>;
                            time: {
                                start: number;
                                end: number;
                                compacted?: number | undefined;
                            };
                            attachments?: {
                                [x: string]: any;
                                type: "file";
                                mime: string;
                                filename?: string | undefined;
                                url: string;
                                source?: {
                                    text: {
                                        value: string;
                                        start: number;
                                        end: number;
                                    };
                                    type: "file";
                                    path: string;
                                } | {
                                    text: {
                                        value: string;
                                        start: number;
                                        end: number;
                                    };
                                    type: "symbol";
                                    path: string;
                                    range: {
                                        start: {
                                            line: number;
                                            character: number;
                                        };
                                        end: {
                                            line: number;
                                            character: number;
                                        };
                                    };
                                    name: string;
                                    kind: number;
                                } | {
                                    text: {
                                        value: string;
                                        start: number;
                                        end: number;
                                    };
                                    type: "resource";
                                    clientName: string;
                                    uri: string;
                                } | undefined;
                            }[] | undefined;
                        } | {
                            status: "error";
                            input: Record<string, any>;
                            error: string;
                            metadata?: Record<string, any> | undefined;
                            time: {
                                start: number;
                                end: number;
                            };
                        };
                        metadata?: Record<string, any> | undefined;
                    } | {
                        [x: string]: any;
                        type: "step-start";
                        snapshot?: string | undefined;
                    } | {
                        [x: string]: any;
                        type: "step-finish";
                        reason: string;
                        snapshot?: string | undefined;
                        cost: number;
                        tokens: {
                            total?: number | undefined;
                            input: number;
                            output: number;
                            reasoning: number;
                            cache: {
                                read: number;
                                write: number;
                            };
                        };
                    } | {
                        [x: string]: any;
                        type: "snapshot";
                        snapshot: string;
                    } | {
                        [x: string]: any;
                        type: "patch";
                        hash: string;
                        files: string[];
                    } | {
                        [x: string]: any;
                        type: "agent";
                        name: string;
                        source?: {
                            value: string;
                            start: number;
                            end: number;
                        } | undefined;
                    } | {
                        [x: string]: any;
                        type: "retry";
                        attempt: number;
                        error: {
                            name: "APIError";
                            data: {
                                message: string;
                                statusCode?: number | undefined;
                                isRetryable: boolean;
                                responseHeaders?: Record<string, string> | undefined;
                                responseBody?: string | undefined;
                                metadata?: Record<string, string> | undefined;
                            };
                        };
                        time: {
                            created: number;
                        };
                    } | {
                        [x: string]: any;
                        type: "compaction";
                        auto: boolean;
                        overflow?: boolean | undefined;
                    };
                };
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID/message": {
            $post: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                } & {
                    json: {
                        [x: string]: any;
                        model?: {
                            providerID: string;
                            modelID: string;
                        } | undefined;
                        agent?: string | undefined;
                        noReply?: boolean | undefined;
                        tools?: Record<string, boolean> | undefined;
                        format?: {
                            type: "text";
                        } | {
                            type: "json_schema";
                            schema: Record<string, any>;
                            retryCount?: number | undefined;
                        } | undefined;
                        system?: string | undefined;
                        variant?: string | undefined;
                        parts: ({
                            id?: any;
                            type: "text";
                            text: string;
                            synthetic?: boolean | undefined;
                            ignored?: boolean | undefined;
                            time?: {
                                start: number;
                                end?: number | undefined;
                            } | undefined;
                            metadata?: Record<string, any> | undefined;
                        } | {
                            id?: any;
                            type: "file";
                            mime: string;
                            filename?: string | undefined;
                            url: string;
                            source?: {
                                text: {
                                    value: string;
                                    start: number;
                                    end: number;
                                };
                                type: "file";
                                path: string;
                            } | {
                                text: {
                                    value: string;
                                    start: number;
                                    end: number;
                                };
                                type: "symbol";
                                path: string;
                                range: {
                                    start: {
                                        line: number;
                                        character: number;
                                    };
                                    end: {
                                        line: number;
                                        character: number;
                                    };
                                };
                                name: string;
                                kind: number;
                            } | {
                                text: {
                                    value: string;
                                    start: number;
                                    end: number;
                                };
                                type: "resource";
                                clientName: string;
                                uri: string;
                            } | undefined;
                        } | {
                            id?: any;
                            type: "agent";
                            name: string;
                            source?: {
                                value: string;
                                start: number;
                                end: number;
                            } | undefined;
                        } | {
                            id?: any;
                            type: "subtask";
                            prompt: string;
                            description: string;
                            agent: string;
                            model?: {
                                providerID: string;
                                modelID: string;
                            } | undefined;
                            command?: string | undefined;
                        })[];
                    };
                };
                output: {};
                outputFormat: string;
                status: import("hono/utils/http-status").StatusCode;
            };
        };
    } & {
        "/:sessionID/prompt_async": {
            $post: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                } & {
                    json: {
                        [x: string]: any;
                        model?: {
                            providerID: string;
                            modelID: string;
                        } | undefined;
                        agent?: string | undefined;
                        noReply?: boolean | undefined;
                        tools?: Record<string, boolean> | undefined;
                        format?: {
                            type: "text";
                        } | {
                            type: "json_schema";
                            schema: Record<string, any>;
                            retryCount?: number | undefined;
                        } | undefined;
                        system?: string | undefined;
                        variant?: string | undefined;
                        parts: ({
                            id?: any;
                            type: "text";
                            text: string;
                            synthetic?: boolean | undefined;
                            ignored?: boolean | undefined;
                            time?: {
                                start: number;
                                end?: number | undefined;
                            } | undefined;
                            metadata?: Record<string, any> | undefined;
                        } | {
                            id?: any;
                            type: "file";
                            mime: string;
                            filename?: string | undefined;
                            url: string;
                            source?: {
                                text: {
                                    value: string;
                                    start: number;
                                    end: number;
                                };
                                type: "file";
                                path: string;
                            } | {
                                text: {
                                    value: string;
                                    start: number;
                                    end: number;
                                };
                                type: "symbol";
                                path: string;
                                range: {
                                    start: {
                                        line: number;
                                        character: number;
                                    };
                                    end: {
                                        line: number;
                                        character: number;
                                    };
                                };
                                name: string;
                                kind: number;
                            } | {
                                text: {
                                    value: string;
                                    start: number;
                                    end: number;
                                };
                                type: "resource";
                                clientName: string;
                                uri: string;
                            } | undefined;
                        } | {
                            id?: any;
                            type: "agent";
                            name: string;
                            source?: {
                                value: string;
                                start: number;
                                end: number;
                            } | undefined;
                        } | {
                            id?: any;
                            type: "subtask";
                            prompt: string;
                            description: string;
                            agent: string;
                            model?: {
                                providerID: string;
                                modelID: string;
                            } | undefined;
                            command?: string | undefined;
                        })[];
                    };
                };
                output: {};
                outputFormat: string;
                status: import("hono/utils/http-status").StatusCode;
            };
        };
    } & {
        "/:sessionID/command": {
            $post: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                } & {
                    json: {
                        [x: string]: any;
                        agent?: string | undefined;
                        model?: string | undefined;
                        arguments: string;
                        command: string;
                        variant?: string | undefined;
                        parts?: {
                            id?: any;
                            type: "file";
                            mime: string;
                            filename?: string | undefined;
                            url: string;
                            source?: {
                                text: {
                                    value: string;
                                    start: number;
                                    end: number;
                                };
                                type: "file";
                                path: string;
                            } | {
                                text: {
                                    value: string;
                                    start: number;
                                    end: number;
                                };
                                type: "symbol";
                                path: string;
                                range: {
                                    start: {
                                        line: number;
                                        character: number;
                                    };
                                    end: {
                                        line: number;
                                        character: number;
                                    };
                                };
                                name: string;
                                kind: number;
                            } | {
                                text: {
                                    value: string;
                                    start: number;
                                    end: number;
                                };
                                type: "resource";
                                clientName: string;
                                uri: string;
                            } | undefined;
                        }[] | undefined;
                    };
                };
                output: {
                    info: any;
                    parts: any;
                };
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID/shell": {
            $post: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                } & {
                    json: {
                        agent: string;
                        model?: {
                            providerID: string;
                            modelID: string;
                        } | undefined;
                        command: string;
                    };
                };
                output: {
                    info: any;
                    parts: any;
                };
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID/revert": {
            $post: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                } & {
                    json: {
                        [x: string]: any;
                    };
                };
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID/unrevert": {
            $post: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                };
                output: any;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/:sessionID/permissions/:permissionID": {
            $post: {
                input: {
                    param: {
                        [x: string]: any;
                    };
                } & {
                    json: {
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
