export declare const GlobalDisposedEvent: any;
export declare const GlobalRoutes: {
    (): import("hono/hono-base").HonoBase<import("hono/types").BlankEnv, {
        "/readyz": {
            $get: {
                input: {};
                output: {
                    service: "opencode-api";
                    ok: boolean;
                    version: string;
                    checks: {
                        name: string;
                        ok: boolean;
                        target?: string | undefined;
                        detail?: string | undefined;
                        status?: number | undefined;
                        latencyMs: number;
                    }[];
                };
                outputFormat: "json";
                status: 200 | 503;
            };
        };
    } & {
        "/event": {
            $get: {
                input: {};
                output: {};
                outputFormat: string;
                status: import("hono/utils/http-status").StatusCode;
            };
        };
    } & {
        "/config": {
            $get: {
                input: {};
                output: {
                    $schema?: string | undefined;
                    logLevel?: "DEBUG" | "ERROR" | "INFO" | "WARN" | undefined;
                    server?: {
                        port?: number | undefined;
                        hostname?: string | undefined;
                        mdns?: boolean | undefined;
                        mdnsDomain?: string | undefined;
                        cors?: string[] | undefined;
                    } | undefined;
                    command?: {
                        [x: string]: {
                            template: string;
                            description?: string | undefined;
                            agent?: string | undefined;
                            model?: string | undefined;
                            subtask?: boolean | undefined;
                        };
                    } | undefined;
                    skills?: {
                        paths?: string[] | undefined;
                        urls?: string[] | undefined;
                    } | undefined;
                    watcher?: {
                        ignore?: string[] | undefined;
                    } | undefined;
                    plugin?: string[] | undefined;
                    snapshot?: boolean | undefined;
                    share?: "auto" | "disabled" | "manual" | undefined;
                    autoshare?: boolean | undefined;
                    autoupdate?: "notify" | boolean | undefined;
                    disabled_providers?: string[] | undefined;
                    enabled_providers?: string[] | undefined;
                    model?: string | undefined;
                    small_model?: string | undefined;
                    default_agent?: string | undefined;
                    username?: string | undefined;
                    mode?: {
                        [x: string]: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        };
                        build?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                        plan?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                    } | undefined;
                    agent?: {
                        [x: string]: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        };
                        plan?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                        build?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                        general?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                        explore?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                        title?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                        summary?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                        compaction?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                    } | undefined;
                    provider?: {
                        [x: string]: {
                            api?: string | undefined;
                            name?: string | undefined;
                            env?: string[] | undefined;
                            id?: string | undefined;
                            npm?: string | undefined;
                            whitelist?: string[] | undefined;
                            blacklist?: string[] | undefined;
                            models?: {
                                [x: string]: {
                                    id?: string | undefined;
                                    name?: string | undefined;
                                    family?: string | undefined;
                                    release_date?: string | undefined;
                                    attachment?: boolean | undefined;
                                    reasoning?: boolean | undefined;
                                    temperature?: boolean | undefined;
                                    tool_call?: boolean | undefined;
                                    interleaved?: true | {
                                        field: "reasoning_content" | "reasoning_details";
                                    } | undefined;
                                    cost?: {
                                        input: number;
                                        output: number;
                                        cache_read?: number | undefined;
                                        cache_write?: number | undefined;
                                        context_over_200k?: {
                                            input: number;
                                            output: number;
                                            cache_read?: number | undefined;
                                            cache_write?: number | undefined;
                                        } | undefined;
                                    } | undefined;
                                    limit?: {
                                        context: number;
                                        input?: number | undefined;
                                        output: number;
                                    } | undefined;
                                    modalities?: {
                                        input: ("audio" | "image" | "pdf" | "text" | "video")[];
                                        output: ("audio" | "image" | "pdf" | "text" | "video")[];
                                    } | undefined;
                                    experimental?: boolean | undefined;
                                    status?: "alpha" | "beta" | "deprecated" | undefined;
                                    options?: {
                                        [x: string]: any;
                                    } | undefined;
                                    headers?: {
                                        [x: string]: string;
                                    } | undefined;
                                    provider?: {
                                        npm?: string | undefined;
                                        api?: string | undefined;
                                    } | undefined;
                                    variants?: {
                                        [x: string]: {
                                            [x: string]: any;
                                            disabled?: boolean | undefined;
                                        };
                                    } | undefined;
                                };
                            } | undefined;
                            options?: {
                                [x: string]: any;
                                apiKey?: string | undefined;
                                baseURL?: string | undefined;
                                enterpriseUrl?: string | undefined;
                                setCacheKey?: boolean | undefined;
                                timeout?: number | false | undefined;
                                chunkTimeout?: number | undefined;
                            } | undefined;
                        };
                    } | undefined;
                    mcp?: {
                        [x: string]: {
                            type: "local";
                            command: string[];
                            environment?: {
                                [x: string]: string;
                            } | undefined;
                            enabled?: boolean | undefined;
                            timeout?: number | undefined;
                        } | {
                            type: "remote";
                            url: string;
                            enabled?: boolean | undefined;
                            headers?: {
                                [x: string]: string;
                            } | undefined;
                            oauth?: false | {
                                clientId?: string | undefined;
                                clientSecret?: string | undefined;
                                scope?: string | undefined;
                            } | undefined;
                            timeout?: number | undefined;
                        } | {
                            enabled: boolean;
                        };
                    } | undefined;
                    formatter?: false | {
                        [x: string]: {
                            disabled?: boolean | undefined;
                            command?: string[] | undefined;
                            environment?: {
                                [x: string]: string;
                            } | undefined;
                            extensions?: string[] | undefined;
                        };
                    } | undefined;
                    lsp?: false | {
                        [x: string]: {
                            disabled: true;
                        } | {
                            command: string[];
                            extensions?: string[] | undefined;
                            disabled?: boolean | undefined;
                            env?: {
                                [x: string]: string;
                            } | undefined;
                            initialization?: {
                                [x: string]: any;
                            } | undefined;
                        };
                    } | undefined;
                    instructions?: string[] | undefined;
                    layout?: "auto" | "stretch" | undefined;
                    permission?: {
                        [x: string]: "allow" | "ask" | "deny" | {
                            [x: string]: "allow" | "ask" | "deny";
                        };
                    } | undefined;
                    tools?: {
                        [x: string]: boolean;
                    } | undefined;
                    enterprise?: {
                        url?: string | undefined;
                    } | undefined;
                    compaction?: {
                        auto?: boolean | undefined;
                        prune?: boolean | undefined;
                        reserved?: number | undefined;
                    } | undefined;
                    experimental?: {
                        disable_paste_summary?: boolean | undefined;
                        batch_tool?: boolean | undefined;
                        openTelemetry?: boolean | undefined;
                        primary_tools?: string[] | undefined;
                        continue_loop_on_deny?: boolean | undefined;
                        mcp_timeout?: number | undefined;
                    } | undefined;
                };
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/config": {
            $patch: {
                input: {
                    json: {
                        $schema?: string | undefined;
                        logLevel?: "DEBUG" | "ERROR" | "INFO" | "WARN" | undefined;
                        server?: {
                            port?: number | undefined;
                            hostname?: string | undefined;
                            mdns?: boolean | undefined;
                            mdnsDomain?: string | undefined;
                            cors?: string[] | undefined;
                        } | undefined;
                        command?: Record<string, {
                            template: string;
                            description?: string | undefined;
                            agent?: string | undefined;
                            model?: string | undefined;
                            subtask?: boolean | undefined;
                        }> | undefined;
                        skills?: {
                            paths?: string[] | undefined;
                            urls?: string[] | undefined;
                        } | undefined;
                        watcher?: {
                            ignore?: string[] | undefined;
                        } | undefined;
                        plugin?: string[] | undefined;
                        snapshot?: boolean | undefined;
                        share?: "auto" | "disabled" | "manual" | undefined;
                        autoshare?: boolean | undefined;
                        autoupdate?: "notify" | boolean | undefined;
                        disabled_providers?: string[] | undefined;
                        enabled_providers?: string[] | undefined;
                        model?: string | undefined;
                        small_model?: string | undefined;
                        default_agent?: string | undefined;
                        username?: string | undefined;
                        mode?: {
                            [x: string]: {
                                [x: string]: any;
                                model?: string | undefined;
                                variant?: string | undefined;
                                temperature?: number | undefined;
                                top_p?: number | undefined;
                                prompt?: string | undefined;
                                tools?: Record<string, boolean> | undefined;
                                disable?: boolean | undefined;
                                description?: string | undefined;
                                mode?: "all" | "primary" | "subagent" | undefined;
                                hidden?: boolean | undefined;
                                options?: Record<string, any> | undefined;
                                color?: string | undefined;
                                steps?: number | undefined;
                                maxSteps?: number | undefined;
                                permission?: unknown;
                            };
                            build?: {
                                [x: string]: any;
                                model?: string | undefined;
                                variant?: string | undefined;
                                temperature?: number | undefined;
                                top_p?: number | undefined;
                                prompt?: string | undefined;
                                tools?: Record<string, boolean> | undefined;
                                disable?: boolean | undefined;
                                description?: string | undefined;
                                mode?: "all" | "primary" | "subagent" | undefined;
                                hidden?: boolean | undefined;
                                options?: Record<string, any> | undefined;
                                color?: string | undefined;
                                steps?: number | undefined;
                                maxSteps?: number | undefined;
                                permission?: unknown;
                            } | undefined;
                            plan?: {
                                [x: string]: any;
                                model?: string | undefined;
                                variant?: string | undefined;
                                temperature?: number | undefined;
                                top_p?: number | undefined;
                                prompt?: string | undefined;
                                tools?: Record<string, boolean> | undefined;
                                disable?: boolean | undefined;
                                description?: string | undefined;
                                mode?: "all" | "primary" | "subagent" | undefined;
                                hidden?: boolean | undefined;
                                options?: Record<string, any> | undefined;
                                color?: string | undefined;
                                steps?: number | undefined;
                                maxSteps?: number | undefined;
                                permission?: unknown;
                            } | undefined;
                        } | undefined;
                        agent?: {
                            [x: string]: {
                                [x: string]: any;
                                model?: string | undefined;
                                variant?: string | undefined;
                                temperature?: number | undefined;
                                top_p?: number | undefined;
                                prompt?: string | undefined;
                                tools?: Record<string, boolean> | undefined;
                                disable?: boolean | undefined;
                                description?: string | undefined;
                                mode?: "all" | "primary" | "subagent" | undefined;
                                hidden?: boolean | undefined;
                                options?: Record<string, any> | undefined;
                                color?: string | undefined;
                                steps?: number | undefined;
                                maxSteps?: number | undefined;
                                permission?: unknown;
                            };
                            plan?: {
                                [x: string]: any;
                                model?: string | undefined;
                                variant?: string | undefined;
                                temperature?: number | undefined;
                                top_p?: number | undefined;
                                prompt?: string | undefined;
                                tools?: Record<string, boolean> | undefined;
                                disable?: boolean | undefined;
                                description?: string | undefined;
                                mode?: "all" | "primary" | "subagent" | undefined;
                                hidden?: boolean | undefined;
                                options?: Record<string, any> | undefined;
                                color?: string | undefined;
                                steps?: number | undefined;
                                maxSteps?: number | undefined;
                                permission?: unknown;
                            } | undefined;
                            build?: {
                                [x: string]: any;
                                model?: string | undefined;
                                variant?: string | undefined;
                                temperature?: number | undefined;
                                top_p?: number | undefined;
                                prompt?: string | undefined;
                                tools?: Record<string, boolean> | undefined;
                                disable?: boolean | undefined;
                                description?: string | undefined;
                                mode?: "all" | "primary" | "subagent" | undefined;
                                hidden?: boolean | undefined;
                                options?: Record<string, any> | undefined;
                                color?: string | undefined;
                                steps?: number | undefined;
                                maxSteps?: number | undefined;
                                permission?: unknown;
                            } | undefined;
                            general?: {
                                [x: string]: any;
                                model?: string | undefined;
                                variant?: string | undefined;
                                temperature?: number | undefined;
                                top_p?: number | undefined;
                                prompt?: string | undefined;
                                tools?: Record<string, boolean> | undefined;
                                disable?: boolean | undefined;
                                description?: string | undefined;
                                mode?: "all" | "primary" | "subagent" | undefined;
                                hidden?: boolean | undefined;
                                options?: Record<string, any> | undefined;
                                color?: string | undefined;
                                steps?: number | undefined;
                                maxSteps?: number | undefined;
                                permission?: unknown;
                            } | undefined;
                            explore?: {
                                [x: string]: any;
                                model?: string | undefined;
                                variant?: string | undefined;
                                temperature?: number | undefined;
                                top_p?: number | undefined;
                                prompt?: string | undefined;
                                tools?: Record<string, boolean> | undefined;
                                disable?: boolean | undefined;
                                description?: string | undefined;
                                mode?: "all" | "primary" | "subagent" | undefined;
                                hidden?: boolean | undefined;
                                options?: Record<string, any> | undefined;
                                color?: string | undefined;
                                steps?: number | undefined;
                                maxSteps?: number | undefined;
                                permission?: unknown;
                            } | undefined;
                            title?: {
                                [x: string]: any;
                                model?: string | undefined;
                                variant?: string | undefined;
                                temperature?: number | undefined;
                                top_p?: number | undefined;
                                prompt?: string | undefined;
                                tools?: Record<string, boolean> | undefined;
                                disable?: boolean | undefined;
                                description?: string | undefined;
                                mode?: "all" | "primary" | "subagent" | undefined;
                                hidden?: boolean | undefined;
                                options?: Record<string, any> | undefined;
                                color?: string | undefined;
                                steps?: number | undefined;
                                maxSteps?: number | undefined;
                                permission?: unknown;
                            } | undefined;
                            summary?: {
                                [x: string]: any;
                                model?: string | undefined;
                                variant?: string | undefined;
                                temperature?: number | undefined;
                                top_p?: number | undefined;
                                prompt?: string | undefined;
                                tools?: Record<string, boolean> | undefined;
                                disable?: boolean | undefined;
                                description?: string | undefined;
                                mode?: "all" | "primary" | "subagent" | undefined;
                                hidden?: boolean | undefined;
                                options?: Record<string, any> | undefined;
                                color?: string | undefined;
                                steps?: number | undefined;
                                maxSteps?: number | undefined;
                                permission?: unknown;
                            } | undefined;
                            compaction?: {
                                [x: string]: any;
                                model?: string | undefined;
                                variant?: string | undefined;
                                temperature?: number | undefined;
                                top_p?: number | undefined;
                                prompt?: string | undefined;
                                tools?: Record<string, boolean> | undefined;
                                disable?: boolean | undefined;
                                description?: string | undefined;
                                mode?: "all" | "primary" | "subagent" | undefined;
                                hidden?: boolean | undefined;
                                options?: Record<string, any> | undefined;
                                color?: string | undefined;
                                steps?: number | undefined;
                                maxSteps?: number | undefined;
                                permission?: unknown;
                            } | undefined;
                        } | undefined;
                        provider?: Record<string, {
                            api?: string | undefined;
                            name?: string | undefined;
                            env?: string[] | undefined;
                            id?: string | undefined;
                            npm?: string | undefined;
                            whitelist?: string[] | undefined;
                            blacklist?: string[] | undefined;
                            models?: Record<string, {
                                id?: string | undefined;
                                name?: string | undefined;
                                family?: string | undefined;
                                release_date?: string | undefined;
                                attachment?: boolean | undefined;
                                reasoning?: boolean | undefined;
                                temperature?: boolean | undefined;
                                tool_call?: boolean | undefined;
                                interleaved?: true | {
                                    field: "reasoning_content" | "reasoning_details";
                                } | undefined;
                                cost?: {
                                    input: number;
                                    output: number;
                                    cache_read?: number | undefined;
                                    cache_write?: number | undefined;
                                    context_over_200k?: {
                                        input: number;
                                        output: number;
                                        cache_read?: number | undefined;
                                        cache_write?: number | undefined;
                                    } | undefined;
                                } | undefined;
                                limit?: {
                                    context: number;
                                    input?: number | undefined;
                                    output: number;
                                } | undefined;
                                modalities?: {
                                    input: ("audio" | "image" | "pdf" | "text" | "video")[];
                                    output: ("audio" | "image" | "pdf" | "text" | "video")[];
                                } | undefined;
                                experimental?: boolean | undefined;
                                status?: "alpha" | "beta" | "deprecated" | undefined;
                                options?: Record<string, any> | undefined;
                                headers?: Record<string, string> | undefined;
                                provider?: {
                                    npm?: string | undefined;
                                    api?: string | undefined;
                                } | undefined;
                                variants?: Record<string, {
                                    [x: string]: any;
                                    disabled?: boolean | undefined;
                                }> | undefined;
                            }> | undefined;
                            options?: {
                                [x: string]: any;
                                apiKey?: string | undefined;
                                baseURL?: string | undefined;
                                enterpriseUrl?: string | undefined;
                                setCacheKey?: boolean | undefined;
                                timeout?: number | false | undefined;
                                chunkTimeout?: number | undefined;
                            } | undefined;
                        }> | undefined;
                        mcp?: Record<string, {
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
                        } | {
                            enabled: boolean;
                        }> | undefined;
                        formatter?: false | Record<string, {
                            disabled?: boolean | undefined;
                            command?: string[] | undefined;
                            environment?: Record<string, string> | undefined;
                            extensions?: string[] | undefined;
                        }> | undefined;
                        lsp?: false | Record<string, {
                            disabled: true;
                        } | {
                            command: string[];
                            extensions?: string[] | undefined;
                            disabled?: boolean | undefined;
                            env?: Record<string, string> | undefined;
                            initialization?: Record<string, any> | undefined;
                        }> | undefined;
                        instructions?: string[] | undefined;
                        layout?: "auto" | "stretch" | undefined;
                        permission?: unknown;
                        tools?: Record<string, boolean> | undefined;
                        enterprise?: {
                            url?: string | undefined;
                        } | undefined;
                        compaction?: {
                            auto?: boolean | undefined;
                            prune?: boolean | undefined;
                            reserved?: number | undefined;
                        } | undefined;
                        experimental?: {
                            disable_paste_summary?: boolean | undefined;
                            batch_tool?: boolean | undefined;
                            openTelemetry?: boolean | undefined;
                            primary_tools?: string[] | undefined;
                            continue_loop_on_deny?: boolean | undefined;
                            mcp_timeout?: number | undefined;
                        } | undefined;
                    };
                };
                output: {
                    $schema?: string | undefined;
                    logLevel?: "DEBUG" | "ERROR" | "INFO" | "WARN" | undefined;
                    server?: {
                        port?: number | undefined;
                        hostname?: string | undefined;
                        mdns?: boolean | undefined;
                        mdnsDomain?: string | undefined;
                        cors?: string[] | undefined;
                    } | undefined;
                    command?: {
                        [x: string]: {
                            template: string;
                            description?: string | undefined;
                            agent?: string | undefined;
                            model?: string | undefined;
                            subtask?: boolean | undefined;
                        };
                    } | undefined;
                    skills?: {
                        paths?: string[] | undefined;
                        urls?: string[] | undefined;
                    } | undefined;
                    watcher?: {
                        ignore?: string[] | undefined;
                    } | undefined;
                    plugin?: string[] | undefined;
                    snapshot?: boolean | undefined;
                    share?: "auto" | "disabled" | "manual" | undefined;
                    autoshare?: boolean | undefined;
                    autoupdate?: "notify" | boolean | undefined;
                    disabled_providers?: string[] | undefined;
                    enabled_providers?: string[] | undefined;
                    model?: string | undefined;
                    small_model?: string | undefined;
                    default_agent?: string | undefined;
                    username?: string | undefined;
                    mode?: {
                        [x: string]: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        };
                        build?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                        plan?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                    } | undefined;
                    agent?: {
                        [x: string]: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        };
                        plan?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                        build?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                        general?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                        explore?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                        title?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                        summary?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                        compaction?: {
                            [x: string]: any;
                            model?: string | undefined;
                            variant?: string | undefined;
                            temperature?: number | undefined;
                            top_p?: number | undefined;
                            prompt?: string | undefined;
                            tools?: {
                                [x: string]: boolean;
                            } | undefined;
                            disable?: boolean | undefined;
                            description?: string | undefined;
                            mode?: "all" | "primary" | "subagent" | undefined;
                            hidden?: boolean | undefined;
                            options?: {
                                [x: string]: any;
                            } | undefined;
                            color?: string | undefined;
                            steps?: number | undefined;
                            maxSteps?: number | undefined;
                            permission?: {
                                [x: string]: "allow" | "ask" | "deny" | {
                                    [x: string]: "allow" | "ask" | "deny";
                                };
                            } | undefined;
                        } | undefined;
                    } | undefined;
                    provider?: {
                        [x: string]: {
                            api?: string | undefined;
                            name?: string | undefined;
                            env?: string[] | undefined;
                            id?: string | undefined;
                            npm?: string | undefined;
                            whitelist?: string[] | undefined;
                            blacklist?: string[] | undefined;
                            models?: {
                                [x: string]: {
                                    id?: string | undefined;
                                    name?: string | undefined;
                                    family?: string | undefined;
                                    release_date?: string | undefined;
                                    attachment?: boolean | undefined;
                                    reasoning?: boolean | undefined;
                                    temperature?: boolean | undefined;
                                    tool_call?: boolean | undefined;
                                    interleaved?: true | {
                                        field: "reasoning_content" | "reasoning_details";
                                    } | undefined;
                                    cost?: {
                                        input: number;
                                        output: number;
                                        cache_read?: number | undefined;
                                        cache_write?: number | undefined;
                                        context_over_200k?: {
                                            input: number;
                                            output: number;
                                            cache_read?: number | undefined;
                                            cache_write?: number | undefined;
                                        } | undefined;
                                    } | undefined;
                                    limit?: {
                                        context: number;
                                        input?: number | undefined;
                                        output: number;
                                    } | undefined;
                                    modalities?: {
                                        input: ("audio" | "image" | "pdf" | "text" | "video")[];
                                        output: ("audio" | "image" | "pdf" | "text" | "video")[];
                                    } | undefined;
                                    experimental?: boolean | undefined;
                                    status?: "alpha" | "beta" | "deprecated" | undefined;
                                    options?: {
                                        [x: string]: any;
                                    } | undefined;
                                    headers?: {
                                        [x: string]: string;
                                    } | undefined;
                                    provider?: {
                                        npm?: string | undefined;
                                        api?: string | undefined;
                                    } | undefined;
                                    variants?: {
                                        [x: string]: {
                                            [x: string]: any;
                                            disabled?: boolean | undefined;
                                        };
                                    } | undefined;
                                };
                            } | undefined;
                            options?: {
                                [x: string]: any;
                                apiKey?: string | undefined;
                                baseURL?: string | undefined;
                                enterpriseUrl?: string | undefined;
                                setCacheKey?: boolean | undefined;
                                timeout?: number | false | undefined;
                                chunkTimeout?: number | undefined;
                            } | undefined;
                        };
                    } | undefined;
                    mcp?: {
                        [x: string]: {
                            type: "local";
                            command: string[];
                            environment?: {
                                [x: string]: string;
                            } | undefined;
                            enabled?: boolean | undefined;
                            timeout?: number | undefined;
                        } | {
                            type: "remote";
                            url: string;
                            enabled?: boolean | undefined;
                            headers?: {
                                [x: string]: string;
                            } | undefined;
                            oauth?: false | {
                                clientId?: string | undefined;
                                clientSecret?: string | undefined;
                                scope?: string | undefined;
                            } | undefined;
                            timeout?: number | undefined;
                        } | {
                            enabled: boolean;
                        };
                    } | undefined;
                    formatter?: false | {
                        [x: string]: {
                            disabled?: boolean | undefined;
                            command?: string[] | undefined;
                            environment?: {
                                [x: string]: string;
                            } | undefined;
                            extensions?: string[] | undefined;
                        };
                    } | {
                        [x: string]: {
                            disabled?: boolean | undefined;
                            command?: string[] | undefined;
                            environment?: {
                                [x: string]: string;
                            } | undefined;
                            extensions?: string[] | undefined;
                        };
                    } | undefined;
                    lsp?: false | {
                        [x: string]: {
                            disabled: true;
                        } | {
                            command: string[];
                            extensions?: string[] | undefined;
                            disabled?: boolean | undefined;
                            env?: {
                                [x: string]: string;
                            } | undefined;
                            initialization?: {
                                [x: string]: any;
                            } | undefined;
                        };
                    } | {
                        [x: string]: {
                            disabled: true;
                        } | {
                            command: string[];
                            extensions?: string[] | undefined;
                            disabled?: boolean | undefined;
                            env?: {
                                [x: string]: string;
                            } | undefined;
                            initialization?: {
                                [x: string]: any;
                            } | undefined;
                        };
                    } | undefined;
                    instructions?: string[] | undefined;
                    layout?: "auto" | "stretch" | undefined;
                    permission?: {
                        [x: string]: "allow" | "ask" | "deny" | {
                            [x: string]: "allow" | "ask" | "deny";
                        };
                    } | undefined;
                    tools?: {
                        [x: string]: boolean;
                    } | undefined;
                    enterprise?: {
                        url?: string | undefined;
                    } | undefined;
                    compaction?: {
                        auto?: boolean | undefined;
                        prune?: boolean | undefined;
                        reserved?: number | undefined;
                    } | undefined;
                    experimental?: {
                        disable_paste_summary?: boolean | undefined;
                        batch_tool?: boolean | undefined;
                        openTelemetry?: boolean | undefined;
                        primary_tools?: string[] | undefined;
                        continue_loop_on_deny?: boolean | undefined;
                        mcp_timeout?: number | undefined;
                    } | undefined;
                };
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    } & {
        "/dispose": {
            $post: {
                input: {};
                output: true;
                outputFormat: "json";
                status: import("hono/utils/http-status").ContentfulStatusCode;
            };
        };
    }, "/">;
    reset: () => void;
};
