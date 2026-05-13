import z from "zod";
import { ConfigPaths } from "./paths";
export declare namespace Config {
    function managedConfigDir(): string;
    const state: () => Promise<{
        config: {
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                };
                build?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
                plan?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                };
                plan?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
                build?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
                general?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
                explore?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
                title?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
                summary?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
                compaction?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
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
            permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
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
        directories: any[];
        deps: any[];
    }>;
    function waitForDependencies(): Promise<void>;
    function installDependencies(dir: string): Promise<void>;
    function needsInstall(dir: string): Promise<boolean>;
    /**
     * Extracts a canonical plugin name from a plugin specifier.
     * - For file:// URLs: extracts filename without extension
     * - For npm packages: extracts package name without version
     *
     * @example
     * getPluginName("file:///path/to/plugin/foo.js") // "foo"
     * getPluginName("oh-my-opencode@2.4.3") // "oh-my-opencode"
     * getPluginName("@scope/pkg@1.0.0") // "@scope/pkg"
     */
    function getPluginName(plugin: string): string;
    /**
     * Deduplicates plugins by name, with later entries (higher priority) winning.
     * Priority order (highest to lowest):
     * 1. Local plugin/ directory
     * 2. Local opencode.json
     * 3. Global plugin/ directory
     * 4. Global opencode.json
     *
     * Since plugins are added in low-to-high priority order,
     * we reverse, deduplicate (keeping first occurrence), then restore order.
     */
    function deduplicatePlugins(plugins: string[]): string[];
    const McpLocal: z.ZodObject<{
        type: z.ZodLiteral<"local">;
        command: z.ZodArray<z.ZodString>;
        environment: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        enabled: z.ZodOptional<z.ZodBoolean>;
        timeout: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
    const McpOAuth: z.ZodObject<{
        clientId: z.ZodOptional<z.ZodString>;
        clientSecret: z.ZodOptional<z.ZodString>;
        scope: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    type McpOAuth = z.infer<typeof McpOAuth>;
    const McpRemote: z.ZodObject<{
        type: z.ZodLiteral<"remote">;
        url: z.ZodString;
        enabled: z.ZodOptional<z.ZodBoolean>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        oauth: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
            clientId: z.ZodOptional<z.ZodString>;
            clientSecret: z.ZodOptional<z.ZodString>;
            scope: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>, z.ZodLiteral<false>]>>;
        timeout: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
    const Mcp: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"local">;
        command: z.ZodArray<z.ZodString>;
        environment: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        enabled: z.ZodOptional<z.ZodBoolean>;
        timeout: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"remote">;
        url: z.ZodString;
        enabled: z.ZodOptional<z.ZodBoolean>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        oauth: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
            clientId: z.ZodOptional<z.ZodString>;
            clientSecret: z.ZodOptional<z.ZodString>;
            scope: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>, z.ZodLiteral<false>]>>;
        timeout: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>], "type">;
    type Mcp = z.infer<typeof Mcp>;
    const PermissionAction: z.ZodEnum<{
        allow: "allow";
        ask: "ask";
        deny: "deny";
    }>;
    type PermissionAction = z.infer<typeof PermissionAction>;
    const PermissionObject: z.ZodRecord<z.ZodString, z.ZodEnum<{
        allow: "allow";
        ask: "ask";
        deny: "deny";
    }>>;
    type PermissionObject = z.infer<typeof PermissionObject>;
    const PermissionRule: z.ZodUnion<readonly [z.ZodEnum<{
        allow: "allow";
        ask: "ask";
        deny: "deny";
    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
        allow: "allow";
        ask: "ask";
        deny: "deny";
    }>>]>;
    type PermissionRule = z.infer<typeof PermissionRule>;
    const Permission: z.ZodPipe<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodUnion<[z.ZodObject<{
        __originalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
        read: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>]>>;
        edit: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>]>>;
        glob: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>]>>;
        grep: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>]>>;
        list: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>]>>;
        pyodide: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>]>>;
        task: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>]>>;
        external_directory: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>]>>;
        todowrite: z.ZodOptional<z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>;
        todoread: z.ZodOptional<z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>;
        question: z.ZodOptional<z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>;
        webfetch: z.ZodOptional<z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>;
        websearch: z.ZodOptional<z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>;
        codesearch: z.ZodOptional<z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>;
        lsp: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>]>>;
        doom_loop: z.ZodOptional<z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>;
        skill: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>]>>;
    }, z.core.$catchall<z.ZodUnion<readonly [z.ZodEnum<{
        allow: "allow";
        ask: "ask";
        deny: "deny";
    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
        allow: "allow";
        ask: "ask";
        deny: "deny";
    }>>]>>>, z.ZodEnum<{
        allow: "allow";
        ask: "ask";
        deny: "deny";
    }>]>>, z.ZodTransform<Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">>, "allow" | "ask" | "deny" | {
        [x: string]: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">;
        __originalKeys?: string[] | undefined;
        read?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
        edit?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
        glob?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
        grep?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
        list?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
        pyodide?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
        task?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
        external_directory?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
        todowrite?: "allow" | "ask" | "deny" | undefined;
        todoread?: "allow" | "ask" | "deny" | undefined;
        question?: "allow" | "ask" | "deny" | undefined;
        webfetch?: "allow" | "ask" | "deny" | undefined;
        websearch?: "allow" | "ask" | "deny" | undefined;
        codesearch?: "allow" | "ask" | "deny" | undefined;
        lsp?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
        doom_loop?: "allow" | "ask" | "deny" | undefined;
        skill?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
    }>>;
    type Permission = z.infer<typeof Permission>;
    const Command: z.ZodObject<{
        template: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        agent: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        subtask: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    type Command = z.infer<typeof Command>;
    const Skills: z.ZodObject<{
        paths: z.ZodOptional<z.ZodArray<z.ZodString>>;
        urls: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
    type Skills = z.infer<typeof Skills>;
    const Agent: z.ZodPipe<z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        variant: z.ZodOptional<z.ZodString>;
        temperature: z.ZodOptional<z.ZodNumber>;
        top_p: z.ZodOptional<z.ZodNumber>;
        prompt: z.ZodOptional<z.ZodString>;
        tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        disable: z.ZodOptional<z.ZodBoolean>;
        description: z.ZodOptional<z.ZodString>;
        mode: z.ZodOptional<z.ZodEnum<{
            all: "all";
            primary: "primary";
            subagent: "subagent";
        }>>;
        hidden: z.ZodOptional<z.ZodBoolean>;
        options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        color: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodEnum<{
            accent: "accent";
            error: "error";
            info: "info";
            primary: "primary";
            secondary: "secondary";
            success: "success";
            warning: "warning";
        }>]>>;
        steps: z.ZodOptional<z.ZodNumber>;
        maxSteps: z.ZodOptional<z.ZodNumber>;
        permission: z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodUnion<[z.ZodObject<{
            __originalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
            read: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            edit: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            glob: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            grep: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            list: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            pyodide: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            task: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            external_directory: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            todowrite: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            todoread: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            question: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            webfetch: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            websearch: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            codesearch: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            lsp: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            doom_loop: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            skill: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
        }, z.core.$catchall<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>]>>>, z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>]>>, z.ZodTransform<Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">>, "allow" | "ask" | "deny" | {
            [x: string]: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">;
            __originalKeys?: string[] | undefined;
            read?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            edit?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            glob?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            grep?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            list?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            pyodide?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            task?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            external_directory?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            todowrite?: "allow" | "ask" | "deny" | undefined;
            todoread?: "allow" | "ask" | "deny" | undefined;
            question?: "allow" | "ask" | "deny" | undefined;
            webfetch?: "allow" | "ask" | "deny" | undefined;
            websearch?: "allow" | "ask" | "deny" | undefined;
            codesearch?: "allow" | "ask" | "deny" | undefined;
            lsp?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            doom_loop?: "allow" | "ask" | "deny" | undefined;
            skill?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
        }>>>;
    }, z.core.$catchall<z.ZodAny>>, z.ZodTransform<{
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
        permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
    } & {
        options?: Record<string, unknown> | undefined;
        permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
        steps?: number | undefined;
    }, {
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
        permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
    }>>;
    type Agent = z.infer<typeof Agent>;
    const Keybinds: z.ZodObject<{
        leader: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        app_exit: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        editor_open: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        theme_list: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        sidebar_toggle: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        scrollbar_toggle: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        username_toggle: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        status_view: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        session_export: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        session_new: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        session_list: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        session_timeline: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        session_fork: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        session_rename: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        session_delete: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        stash_delete: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        model_provider_list: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        model_favorite_toggle: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        session_share: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        session_unshare: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        session_interrupt: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        session_compact: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        messages_page_up: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        messages_page_down: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        messages_line_up: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        messages_line_down: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        messages_half_page_up: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        messages_half_page_down: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        messages_first: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        messages_last: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        messages_next: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        messages_previous: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        messages_last_user: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        messages_copy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        messages_undo: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        messages_redo: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        messages_toggle_conceal: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        tool_details: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        model_list: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        model_cycle_recent: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        model_cycle_recent_reverse: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        model_cycle_favorite: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        model_cycle_favorite_reverse: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        command_list: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        agent_list: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        agent_cycle: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        agent_cycle_reverse: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        variant_cycle: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_clear: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_paste: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_submit: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_newline: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_move_left: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_move_right: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_move_up: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_move_down: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_select_left: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_select_right: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_select_up: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_select_down: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_line_home: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_line_end: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_select_line_home: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_select_line_end: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_visual_line_home: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_visual_line_end: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_select_visual_line_home: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_select_visual_line_end: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_buffer_home: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_buffer_end: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_select_buffer_home: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_select_buffer_end: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_delete_line: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_delete_to_line_end: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_delete_to_line_start: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_backspace: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_delete: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_undo: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_redo: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_word_forward: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_word_backward: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_select_word_forward: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_select_word_backward: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_delete_word_forward: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        input_delete_word_backward: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        history_previous: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        history_next: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        session_child_first: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        session_child_cycle: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        session_child_cycle_reverse: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        session_parent: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        terminal_suspend: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        terminal_title_toggle: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        tips_toggle: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        display_thinking: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    }, z.core.$strict>;
    const Server: z.ZodObject<{
        port: z.ZodOptional<z.ZodNumber>;
        hostname: z.ZodOptional<z.ZodString>;
        mdns: z.ZodOptional<z.ZodBoolean>;
        mdnsDomain: z.ZodOptional<z.ZodString>;
        cors: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    const Layout: z.ZodEnum<{
        auto: "auto";
        stretch: "stretch";
    }>;
    type Layout = z.infer<typeof Layout>;
    const Provider: z.ZodObject<{
        api: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        name: z.ZodOptional<z.ZodString>;
        env: z.ZodOptional<z.ZodArray<z.ZodString>>;
        id: z.ZodOptional<z.ZodString>;
        npm: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        whitelist: z.ZodOptional<z.ZodArray<z.ZodString>>;
        blacklist: z.ZodOptional<z.ZodArray<z.ZodString>>;
        models: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
            family: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            release_date: z.ZodOptional<z.ZodString>;
            attachment: z.ZodOptional<z.ZodBoolean>;
            reasoning: z.ZodOptional<z.ZodBoolean>;
            temperature: z.ZodOptional<z.ZodBoolean>;
            tool_call: z.ZodOptional<z.ZodBoolean>;
            interleaved: z.ZodOptional<z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<true>, z.ZodObject<{
                field: z.ZodEnum<{
                    reasoning_content: "reasoning_content";
                    reasoning_details: "reasoning_details";
                }>;
            }, z.core.$strict>]>>>;
            cost: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                input: z.ZodNumber;
                output: z.ZodNumber;
                cache_read: z.ZodOptional<z.ZodNumber>;
                cache_write: z.ZodOptional<z.ZodNumber>;
                context_over_200k: z.ZodOptional<z.ZodObject<{
                    input: z.ZodNumber;
                    output: z.ZodNumber;
                    cache_read: z.ZodOptional<z.ZodNumber>;
                    cache_write: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>>;
            limit: z.ZodOptional<z.ZodObject<{
                context: z.ZodNumber;
                input: z.ZodOptional<z.ZodNumber>;
                output: z.ZodNumber;
            }, z.core.$strip>>;
            modalities: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                input: z.ZodArray<z.ZodEnum<{
                    audio: "audio";
                    image: "image";
                    pdf: "pdf";
                    text: "text";
                    video: "video";
                }>>;
                output: z.ZodArray<z.ZodEnum<{
                    audio: "audio";
                    image: "image";
                    pdf: "pdf";
                    text: "text";
                    video: "video";
                }>>;
            }, z.core.$strip>>>;
            experimental: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            status: z.ZodOptional<z.ZodOptional<z.ZodEnum<{
                alpha: "alpha";
                beta: "beta";
                deprecated: "deprecated";
            }>>>;
            options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            headers: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>>;
            provider: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                npm: z.ZodOptional<z.ZodString>;
                api: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>>;
            variants: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
                disabled: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$catchall<z.ZodAny>>>>;
        }, z.core.$strip>>>;
        options: z.ZodOptional<z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            baseURL: z.ZodOptional<z.ZodString>;
            enterpriseUrl: z.ZodOptional<z.ZodString>;
            setCacheKey: z.ZodOptional<z.ZodBoolean>;
            timeout: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<false>]>>;
            chunkTimeout: z.ZodOptional<z.ZodNumber>;
        }, z.core.$catchall<z.ZodAny>>>;
    }, z.core.$strict>;
    type Provider = z.infer<typeof Provider>;
    const Info: z.ZodObject<{
        $schema: z.ZodOptional<z.ZodString>;
        logLevel: z.ZodOptional<z.ZodEnum<{
            DEBUG: "DEBUG";
            ERROR: "ERROR";
            INFO: "INFO";
            WARN: "WARN";
        }>>;
        server: z.ZodOptional<z.ZodObject<{
            port: z.ZodOptional<z.ZodNumber>;
            hostname: z.ZodOptional<z.ZodString>;
            mdns: z.ZodOptional<z.ZodBoolean>;
            mdnsDomain: z.ZodOptional<z.ZodString>;
            cors: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>>;
        command: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            template: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            agent: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
            subtask: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>>;
        skills: z.ZodOptional<z.ZodObject<{
            paths: z.ZodOptional<z.ZodArray<z.ZodString>>;
            urls: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
        watcher: z.ZodOptional<z.ZodObject<{
            ignore: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
        plugin: z.ZodOptional<z.ZodArray<z.ZodString>>;
        snapshot: z.ZodOptional<z.ZodBoolean>;
        share: z.ZodOptional<z.ZodEnum<{
            auto: "auto";
            disabled: "disabled";
            manual: "manual";
        }>>;
        autoshare: z.ZodOptional<z.ZodBoolean>;
        autoupdate: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodLiteral<"notify">]>>;
        disabled_providers: z.ZodOptional<z.ZodArray<z.ZodString>>;
        enabled_providers: z.ZodOptional<z.ZodArray<z.ZodString>>;
        model: z.ZodOptional<z.ZodString>;
        small_model: z.ZodOptional<z.ZodString>;
        default_agent: z.ZodOptional<z.ZodString>;
        username: z.ZodOptional<z.ZodString>;
        mode: z.ZodOptional<z.ZodObject<{
            build: z.ZodOptional<z.ZodPipe<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                prompt: z.ZodOptional<z.ZodString>;
                tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
                disable: z.ZodOptional<z.ZodBoolean>;
                description: z.ZodOptional<z.ZodString>;
                mode: z.ZodOptional<z.ZodEnum<{
                    all: "all";
                    primary: "primary";
                    subagent: "subagent";
                }>>;
                hidden: z.ZodOptional<z.ZodBoolean>;
                options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                color: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodEnum<{
                    accent: "accent";
                    error: "error";
                    info: "info";
                    primary: "primary";
                    secondary: "secondary";
                    success: "success";
                    warning: "warning";
                }>]>>;
                steps: z.ZodOptional<z.ZodNumber>;
                maxSteps: z.ZodOptional<z.ZodNumber>;
                permission: z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodUnion<[z.ZodObject<{
                    __originalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
                    read: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    edit: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    glob: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    grep: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    list: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    pyodide: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    task: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    external_directory: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    todowrite: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    todoread: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    question: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    webfetch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    websearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    codesearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    lsp: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    doom_loop: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    skill: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                }, z.core.$catchall<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>>, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>]>>, z.ZodTransform<Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">>, "allow" | "ask" | "deny" | {
                    [x: string]: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">;
                    __originalKeys?: string[] | undefined;
                    read?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    edit?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    glob?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    grep?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    list?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    pyodide?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    task?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    external_directory?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    todowrite?: "allow" | "ask" | "deny" | undefined;
                    todoread?: "allow" | "ask" | "deny" | undefined;
                    question?: "allow" | "ask" | "deny" | undefined;
                    webfetch?: "allow" | "ask" | "deny" | undefined;
                    websearch?: "allow" | "ask" | "deny" | undefined;
                    codesearch?: "allow" | "ask" | "deny" | undefined;
                    lsp?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    doom_loop?: "allow" | "ask" | "deny" | undefined;
                    skill?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                }>>>;
            }, z.core.$catchall<z.ZodAny>>, z.ZodTransform<{
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }, {
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            }>>>;
            plan: z.ZodOptional<z.ZodPipe<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                prompt: z.ZodOptional<z.ZodString>;
                tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
                disable: z.ZodOptional<z.ZodBoolean>;
                description: z.ZodOptional<z.ZodString>;
                mode: z.ZodOptional<z.ZodEnum<{
                    all: "all";
                    primary: "primary";
                    subagent: "subagent";
                }>>;
                hidden: z.ZodOptional<z.ZodBoolean>;
                options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                color: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodEnum<{
                    accent: "accent";
                    error: "error";
                    info: "info";
                    primary: "primary";
                    secondary: "secondary";
                    success: "success";
                    warning: "warning";
                }>]>>;
                steps: z.ZodOptional<z.ZodNumber>;
                maxSteps: z.ZodOptional<z.ZodNumber>;
                permission: z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodUnion<[z.ZodObject<{
                    __originalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
                    read: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    edit: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    glob: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    grep: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    list: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    pyodide: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    task: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    external_directory: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    todowrite: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    todoread: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    question: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    webfetch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    websearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    codesearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    lsp: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    doom_loop: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    skill: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                }, z.core.$catchall<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>>, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>]>>, z.ZodTransform<Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">>, "allow" | "ask" | "deny" | {
                    [x: string]: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">;
                    __originalKeys?: string[] | undefined;
                    read?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    edit?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    glob?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    grep?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    list?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    pyodide?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    task?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    external_directory?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    todowrite?: "allow" | "ask" | "deny" | undefined;
                    todoread?: "allow" | "ask" | "deny" | undefined;
                    question?: "allow" | "ask" | "deny" | undefined;
                    webfetch?: "allow" | "ask" | "deny" | undefined;
                    websearch?: "allow" | "ask" | "deny" | undefined;
                    codesearch?: "allow" | "ask" | "deny" | undefined;
                    lsp?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    doom_loop?: "allow" | "ask" | "deny" | undefined;
                    skill?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                }>>>;
            }, z.core.$catchall<z.ZodAny>>, z.ZodTransform<{
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }, {
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            }>>>;
        }, z.core.$catchall<z.ZodPipe<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            variant: z.ZodOptional<z.ZodString>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                all: "all";
                primary: "primary";
                subagent: "subagent";
            }>>;
            hidden: z.ZodOptional<z.ZodBoolean>;
            options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            color: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodEnum<{
                accent: "accent";
                error: "error";
                info: "info";
                primary: "primary";
                secondary: "secondary";
                success: "success";
                warning: "warning";
            }>]>>;
            steps: z.ZodOptional<z.ZodNumber>;
            maxSteps: z.ZodOptional<z.ZodNumber>;
            permission: z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodUnion<[z.ZodObject<{
                __originalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
                read: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                edit: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                glob: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                grep: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                list: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                pyodide: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                task: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                external_directory: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                todowrite: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                todoread: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                question: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                websearch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                codesearch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                lsp: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                skill: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
            }, z.core.$catchall<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>>, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>]>>, z.ZodTransform<Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">>, "allow" | "ask" | "deny" | {
                [x: string]: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">;
                __originalKeys?: string[] | undefined;
                read?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                edit?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                glob?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                grep?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                list?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                pyodide?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                task?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                external_directory?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                todowrite?: "allow" | "ask" | "deny" | undefined;
                todoread?: "allow" | "ask" | "deny" | undefined;
                question?: "allow" | "ask" | "deny" | undefined;
                webfetch?: "allow" | "ask" | "deny" | undefined;
                websearch?: "allow" | "ask" | "deny" | undefined;
                codesearch?: "allow" | "ask" | "deny" | undefined;
                lsp?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                doom_loop?: "allow" | "ask" | "deny" | undefined;
                skill?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            }>>>;
        }, z.core.$catchall<z.ZodAny>>, z.ZodTransform<{
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
            permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
        } & {
            options?: Record<string, unknown> | undefined;
            permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            steps?: number | undefined;
        }, {
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
            permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
        }>>>>>;
        agent: z.ZodOptional<z.ZodObject<{
            plan: z.ZodOptional<z.ZodPipe<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                prompt: z.ZodOptional<z.ZodString>;
                tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
                disable: z.ZodOptional<z.ZodBoolean>;
                description: z.ZodOptional<z.ZodString>;
                mode: z.ZodOptional<z.ZodEnum<{
                    all: "all";
                    primary: "primary";
                    subagent: "subagent";
                }>>;
                hidden: z.ZodOptional<z.ZodBoolean>;
                options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                color: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodEnum<{
                    accent: "accent";
                    error: "error";
                    info: "info";
                    primary: "primary";
                    secondary: "secondary";
                    success: "success";
                    warning: "warning";
                }>]>>;
                steps: z.ZodOptional<z.ZodNumber>;
                maxSteps: z.ZodOptional<z.ZodNumber>;
                permission: z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodUnion<[z.ZodObject<{
                    __originalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
                    read: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    edit: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    glob: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    grep: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    list: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    pyodide: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    task: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    external_directory: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    todowrite: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    todoread: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    question: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    webfetch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    websearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    codesearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    lsp: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    doom_loop: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    skill: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                }, z.core.$catchall<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>>, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>]>>, z.ZodTransform<Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">>, "allow" | "ask" | "deny" | {
                    [x: string]: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">;
                    __originalKeys?: string[] | undefined;
                    read?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    edit?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    glob?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    grep?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    list?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    pyodide?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    task?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    external_directory?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    todowrite?: "allow" | "ask" | "deny" | undefined;
                    todoread?: "allow" | "ask" | "deny" | undefined;
                    question?: "allow" | "ask" | "deny" | undefined;
                    webfetch?: "allow" | "ask" | "deny" | undefined;
                    websearch?: "allow" | "ask" | "deny" | undefined;
                    codesearch?: "allow" | "ask" | "deny" | undefined;
                    lsp?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    doom_loop?: "allow" | "ask" | "deny" | undefined;
                    skill?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                }>>>;
            }, z.core.$catchall<z.ZodAny>>, z.ZodTransform<{
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }, {
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            }>>>;
            build: z.ZodOptional<z.ZodPipe<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                prompt: z.ZodOptional<z.ZodString>;
                tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
                disable: z.ZodOptional<z.ZodBoolean>;
                description: z.ZodOptional<z.ZodString>;
                mode: z.ZodOptional<z.ZodEnum<{
                    all: "all";
                    primary: "primary";
                    subagent: "subagent";
                }>>;
                hidden: z.ZodOptional<z.ZodBoolean>;
                options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                color: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodEnum<{
                    accent: "accent";
                    error: "error";
                    info: "info";
                    primary: "primary";
                    secondary: "secondary";
                    success: "success";
                    warning: "warning";
                }>]>>;
                steps: z.ZodOptional<z.ZodNumber>;
                maxSteps: z.ZodOptional<z.ZodNumber>;
                permission: z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodUnion<[z.ZodObject<{
                    __originalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
                    read: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    edit: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    glob: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    grep: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    list: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    pyodide: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    task: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    external_directory: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    todowrite: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    todoread: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    question: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    webfetch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    websearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    codesearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    lsp: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    doom_loop: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    skill: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                }, z.core.$catchall<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>>, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>]>>, z.ZodTransform<Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">>, "allow" | "ask" | "deny" | {
                    [x: string]: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">;
                    __originalKeys?: string[] | undefined;
                    read?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    edit?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    glob?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    grep?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    list?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    pyodide?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    task?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    external_directory?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    todowrite?: "allow" | "ask" | "deny" | undefined;
                    todoread?: "allow" | "ask" | "deny" | undefined;
                    question?: "allow" | "ask" | "deny" | undefined;
                    webfetch?: "allow" | "ask" | "deny" | undefined;
                    websearch?: "allow" | "ask" | "deny" | undefined;
                    codesearch?: "allow" | "ask" | "deny" | undefined;
                    lsp?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    doom_loop?: "allow" | "ask" | "deny" | undefined;
                    skill?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                }>>>;
            }, z.core.$catchall<z.ZodAny>>, z.ZodTransform<{
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }, {
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            }>>>;
            general: z.ZodOptional<z.ZodPipe<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                prompt: z.ZodOptional<z.ZodString>;
                tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
                disable: z.ZodOptional<z.ZodBoolean>;
                description: z.ZodOptional<z.ZodString>;
                mode: z.ZodOptional<z.ZodEnum<{
                    all: "all";
                    primary: "primary";
                    subagent: "subagent";
                }>>;
                hidden: z.ZodOptional<z.ZodBoolean>;
                options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                color: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodEnum<{
                    accent: "accent";
                    error: "error";
                    info: "info";
                    primary: "primary";
                    secondary: "secondary";
                    success: "success";
                    warning: "warning";
                }>]>>;
                steps: z.ZodOptional<z.ZodNumber>;
                maxSteps: z.ZodOptional<z.ZodNumber>;
                permission: z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodUnion<[z.ZodObject<{
                    __originalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
                    read: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    edit: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    glob: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    grep: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    list: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    pyodide: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    task: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    external_directory: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    todowrite: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    todoread: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    question: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    webfetch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    websearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    codesearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    lsp: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    doom_loop: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    skill: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                }, z.core.$catchall<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>>, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>]>>, z.ZodTransform<Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">>, "allow" | "ask" | "deny" | {
                    [x: string]: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">;
                    __originalKeys?: string[] | undefined;
                    read?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    edit?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    glob?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    grep?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    list?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    pyodide?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    task?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    external_directory?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    todowrite?: "allow" | "ask" | "deny" | undefined;
                    todoread?: "allow" | "ask" | "deny" | undefined;
                    question?: "allow" | "ask" | "deny" | undefined;
                    webfetch?: "allow" | "ask" | "deny" | undefined;
                    websearch?: "allow" | "ask" | "deny" | undefined;
                    codesearch?: "allow" | "ask" | "deny" | undefined;
                    lsp?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    doom_loop?: "allow" | "ask" | "deny" | undefined;
                    skill?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                }>>>;
            }, z.core.$catchall<z.ZodAny>>, z.ZodTransform<{
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }, {
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            }>>>;
            explore: z.ZodOptional<z.ZodPipe<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                prompt: z.ZodOptional<z.ZodString>;
                tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
                disable: z.ZodOptional<z.ZodBoolean>;
                description: z.ZodOptional<z.ZodString>;
                mode: z.ZodOptional<z.ZodEnum<{
                    all: "all";
                    primary: "primary";
                    subagent: "subagent";
                }>>;
                hidden: z.ZodOptional<z.ZodBoolean>;
                options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                color: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodEnum<{
                    accent: "accent";
                    error: "error";
                    info: "info";
                    primary: "primary";
                    secondary: "secondary";
                    success: "success";
                    warning: "warning";
                }>]>>;
                steps: z.ZodOptional<z.ZodNumber>;
                maxSteps: z.ZodOptional<z.ZodNumber>;
                permission: z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodUnion<[z.ZodObject<{
                    __originalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
                    read: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    edit: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    glob: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    grep: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    list: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    pyodide: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    task: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    external_directory: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    todowrite: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    todoread: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    question: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    webfetch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    websearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    codesearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    lsp: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    doom_loop: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    skill: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                }, z.core.$catchall<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>>, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>]>>, z.ZodTransform<Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">>, "allow" | "ask" | "deny" | {
                    [x: string]: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">;
                    __originalKeys?: string[] | undefined;
                    read?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    edit?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    glob?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    grep?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    list?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    pyodide?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    task?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    external_directory?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    todowrite?: "allow" | "ask" | "deny" | undefined;
                    todoread?: "allow" | "ask" | "deny" | undefined;
                    question?: "allow" | "ask" | "deny" | undefined;
                    webfetch?: "allow" | "ask" | "deny" | undefined;
                    websearch?: "allow" | "ask" | "deny" | undefined;
                    codesearch?: "allow" | "ask" | "deny" | undefined;
                    lsp?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    doom_loop?: "allow" | "ask" | "deny" | undefined;
                    skill?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                }>>>;
            }, z.core.$catchall<z.ZodAny>>, z.ZodTransform<{
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }, {
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            }>>>;
            title: z.ZodOptional<z.ZodPipe<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                prompt: z.ZodOptional<z.ZodString>;
                tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
                disable: z.ZodOptional<z.ZodBoolean>;
                description: z.ZodOptional<z.ZodString>;
                mode: z.ZodOptional<z.ZodEnum<{
                    all: "all";
                    primary: "primary";
                    subagent: "subagent";
                }>>;
                hidden: z.ZodOptional<z.ZodBoolean>;
                options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                color: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodEnum<{
                    accent: "accent";
                    error: "error";
                    info: "info";
                    primary: "primary";
                    secondary: "secondary";
                    success: "success";
                    warning: "warning";
                }>]>>;
                steps: z.ZodOptional<z.ZodNumber>;
                maxSteps: z.ZodOptional<z.ZodNumber>;
                permission: z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodUnion<[z.ZodObject<{
                    __originalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
                    read: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    edit: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    glob: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    grep: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    list: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    pyodide: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    task: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    external_directory: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    todowrite: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    todoread: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    question: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    webfetch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    websearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    codesearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    lsp: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    doom_loop: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    skill: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                }, z.core.$catchall<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>>, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>]>>, z.ZodTransform<Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">>, "allow" | "ask" | "deny" | {
                    [x: string]: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">;
                    __originalKeys?: string[] | undefined;
                    read?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    edit?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    glob?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    grep?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    list?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    pyodide?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    task?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    external_directory?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    todowrite?: "allow" | "ask" | "deny" | undefined;
                    todoread?: "allow" | "ask" | "deny" | undefined;
                    question?: "allow" | "ask" | "deny" | undefined;
                    webfetch?: "allow" | "ask" | "deny" | undefined;
                    websearch?: "allow" | "ask" | "deny" | undefined;
                    codesearch?: "allow" | "ask" | "deny" | undefined;
                    lsp?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    doom_loop?: "allow" | "ask" | "deny" | undefined;
                    skill?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                }>>>;
            }, z.core.$catchall<z.ZodAny>>, z.ZodTransform<{
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }, {
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            }>>>;
            summary: z.ZodOptional<z.ZodPipe<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                prompt: z.ZodOptional<z.ZodString>;
                tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
                disable: z.ZodOptional<z.ZodBoolean>;
                description: z.ZodOptional<z.ZodString>;
                mode: z.ZodOptional<z.ZodEnum<{
                    all: "all";
                    primary: "primary";
                    subagent: "subagent";
                }>>;
                hidden: z.ZodOptional<z.ZodBoolean>;
                options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                color: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodEnum<{
                    accent: "accent";
                    error: "error";
                    info: "info";
                    primary: "primary";
                    secondary: "secondary";
                    success: "success";
                    warning: "warning";
                }>]>>;
                steps: z.ZodOptional<z.ZodNumber>;
                maxSteps: z.ZodOptional<z.ZodNumber>;
                permission: z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodUnion<[z.ZodObject<{
                    __originalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
                    read: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    edit: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    glob: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    grep: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    list: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    pyodide: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    task: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    external_directory: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    todowrite: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    todoread: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    question: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    webfetch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    websearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    codesearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    lsp: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    doom_loop: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    skill: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                }, z.core.$catchall<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>>, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>]>>, z.ZodTransform<Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">>, "allow" | "ask" | "deny" | {
                    [x: string]: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">;
                    __originalKeys?: string[] | undefined;
                    read?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    edit?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    glob?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    grep?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    list?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    pyodide?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    task?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    external_directory?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    todowrite?: "allow" | "ask" | "deny" | undefined;
                    todoread?: "allow" | "ask" | "deny" | undefined;
                    question?: "allow" | "ask" | "deny" | undefined;
                    webfetch?: "allow" | "ask" | "deny" | undefined;
                    websearch?: "allow" | "ask" | "deny" | undefined;
                    codesearch?: "allow" | "ask" | "deny" | undefined;
                    lsp?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    doom_loop?: "allow" | "ask" | "deny" | undefined;
                    skill?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                }>>>;
            }, z.core.$catchall<z.ZodAny>>, z.ZodTransform<{
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }, {
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            }>>>;
            compaction: z.ZodOptional<z.ZodPipe<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                variant: z.ZodOptional<z.ZodString>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                prompt: z.ZodOptional<z.ZodString>;
                tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
                disable: z.ZodOptional<z.ZodBoolean>;
                description: z.ZodOptional<z.ZodString>;
                mode: z.ZodOptional<z.ZodEnum<{
                    all: "all";
                    primary: "primary";
                    subagent: "subagent";
                }>>;
                hidden: z.ZodOptional<z.ZodBoolean>;
                options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                color: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodEnum<{
                    accent: "accent";
                    error: "error";
                    info: "info";
                    primary: "primary";
                    secondary: "secondary";
                    success: "success";
                    warning: "warning";
                }>]>>;
                steps: z.ZodOptional<z.ZodNumber>;
                maxSteps: z.ZodOptional<z.ZodNumber>;
                permission: z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodUnion<[z.ZodObject<{
                    __originalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
                    read: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    edit: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    glob: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    grep: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    list: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    pyodide: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    task: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    external_directory: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    todowrite: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    todoread: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    question: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    webfetch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    websearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    codesearch: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    lsp: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                    doom_loop: z.ZodOptional<z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>;
                    skill: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                        allow: "allow";
                        ask: "ask";
                        deny: "deny";
                    }>>]>>;
                }, z.core.$catchall<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>>, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>]>>, z.ZodTransform<Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">>, "allow" | "ask" | "deny" | {
                    [x: string]: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">;
                    __originalKeys?: string[] | undefined;
                    read?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    edit?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    glob?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    grep?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    list?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    pyodide?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    task?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    external_directory?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    todowrite?: "allow" | "ask" | "deny" | undefined;
                    todoread?: "allow" | "ask" | "deny" | undefined;
                    question?: "allow" | "ask" | "deny" | undefined;
                    webfetch?: "allow" | "ask" | "deny" | undefined;
                    websearch?: "allow" | "ask" | "deny" | undefined;
                    codesearch?: "allow" | "ask" | "deny" | undefined;
                    lsp?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                    doom_loop?: "allow" | "ask" | "deny" | undefined;
                    skill?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                }>>>;
            }, z.core.$catchall<z.ZodAny>>, z.ZodTransform<{
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }, {
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            }>>>;
        }, z.core.$catchall<z.ZodPipe<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            variant: z.ZodOptional<z.ZodString>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                all: "all";
                primary: "primary";
                subagent: "subagent";
            }>>;
            hidden: z.ZodOptional<z.ZodBoolean>;
            options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            color: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodEnum<{
                accent: "accent";
                error: "error";
                info: "info";
                primary: "primary";
                secondary: "secondary";
                success: "success";
                warning: "warning";
            }>]>>;
            steps: z.ZodOptional<z.ZodNumber>;
            maxSteps: z.ZodOptional<z.ZodNumber>;
            permission: z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodUnion<[z.ZodObject<{
                __originalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
                read: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                edit: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                glob: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                grep: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                list: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                pyodide: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                task: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                external_directory: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                todowrite: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                todoread: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                question: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                websearch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                codesearch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                lsp: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                skill: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
            }, z.core.$catchall<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>>, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>]>>, z.ZodTransform<Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">>, "allow" | "ask" | "deny" | {
                [x: string]: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">;
                __originalKeys?: string[] | undefined;
                read?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                edit?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                glob?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                grep?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                list?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                pyodide?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                task?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                external_directory?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                todowrite?: "allow" | "ask" | "deny" | undefined;
                todoread?: "allow" | "ask" | "deny" | undefined;
                question?: "allow" | "ask" | "deny" | undefined;
                webfetch?: "allow" | "ask" | "deny" | undefined;
                websearch?: "allow" | "ask" | "deny" | undefined;
                codesearch?: "allow" | "ask" | "deny" | undefined;
                lsp?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
                doom_loop?: "allow" | "ask" | "deny" | undefined;
                skill?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            }>>>;
        }, z.core.$catchall<z.ZodAny>>, z.ZodTransform<{
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
            permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
        } & {
            options?: Record<string, unknown> | undefined;
            permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            steps?: number | undefined;
        }, {
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
            permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
        }>>>>>;
        provider: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            api: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            name: z.ZodOptional<z.ZodString>;
            env: z.ZodOptional<z.ZodArray<z.ZodString>>;
            id: z.ZodOptional<z.ZodString>;
            npm: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            whitelist: z.ZodOptional<z.ZodArray<z.ZodString>>;
            blacklist: z.ZodOptional<z.ZodArray<z.ZodString>>;
            models: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodOptional<z.ZodString>;
                family: z.ZodOptional<z.ZodOptional<z.ZodString>>;
                release_date: z.ZodOptional<z.ZodString>;
                attachment: z.ZodOptional<z.ZodBoolean>;
                reasoning: z.ZodOptional<z.ZodBoolean>;
                temperature: z.ZodOptional<z.ZodBoolean>;
                tool_call: z.ZodOptional<z.ZodBoolean>;
                interleaved: z.ZodOptional<z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<true>, z.ZodObject<{
                    field: z.ZodEnum<{
                        reasoning_content: "reasoning_content";
                        reasoning_details: "reasoning_details";
                    }>;
                }, z.core.$strict>]>>>;
                cost: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                    input: z.ZodNumber;
                    output: z.ZodNumber;
                    cache_read: z.ZodOptional<z.ZodNumber>;
                    cache_write: z.ZodOptional<z.ZodNumber>;
                    context_over_200k: z.ZodOptional<z.ZodObject<{
                        input: z.ZodNumber;
                        output: z.ZodNumber;
                        cache_read: z.ZodOptional<z.ZodNumber>;
                        cache_write: z.ZodOptional<z.ZodNumber>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>>;
                limit: z.ZodOptional<z.ZodObject<{
                    context: z.ZodNumber;
                    input: z.ZodOptional<z.ZodNumber>;
                    output: z.ZodNumber;
                }, z.core.$strip>>;
                modalities: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                    input: z.ZodArray<z.ZodEnum<{
                        audio: "audio";
                        image: "image";
                        pdf: "pdf";
                        text: "text";
                        video: "video";
                    }>>;
                    output: z.ZodArray<z.ZodEnum<{
                        audio: "audio";
                        image: "image";
                        pdf: "pdf";
                        text: "text";
                        video: "video";
                    }>>;
                }, z.core.$strip>>>;
                experimental: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
                status: z.ZodOptional<z.ZodOptional<z.ZodEnum<{
                    alpha: "alpha";
                    beta: "beta";
                    deprecated: "deprecated";
                }>>>;
                options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                headers: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>>;
                provider: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                    npm: z.ZodOptional<z.ZodString>;
                    api: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
                variants: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
                    disabled: z.ZodOptional<z.ZodBoolean>;
                }, z.core.$catchall<z.ZodAny>>>>;
            }, z.core.$strip>>>;
            options: z.ZodOptional<z.ZodObject<{
                apiKey: z.ZodOptional<z.ZodString>;
                baseURL: z.ZodOptional<z.ZodString>;
                enterpriseUrl: z.ZodOptional<z.ZodString>;
                setCacheKey: z.ZodOptional<z.ZodBoolean>;
                timeout: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<false>]>>;
                chunkTimeout: z.ZodOptional<z.ZodNumber>;
            }, z.core.$catchall<z.ZodAny>>>;
        }, z.core.$strict>>>;
        mcp: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"local">;
            command: z.ZodArray<z.ZodString>;
            environment: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            enabled: z.ZodOptional<z.ZodBoolean>;
            timeout: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"remote">;
            url: z.ZodString;
            enabled: z.ZodOptional<z.ZodBoolean>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            oauth: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
                clientId: z.ZodOptional<z.ZodString>;
                clientSecret: z.ZodOptional<z.ZodString>;
                scope: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>, z.ZodLiteral<false>]>>;
            timeout: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>], "type">, z.ZodObject<{
            enabled: z.ZodBoolean;
        }, z.core.$strict>]>>>;
        formatter: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<false>, z.ZodRecord<z.ZodString, z.ZodObject<{
            disabled: z.ZodOptional<z.ZodBoolean>;
            command: z.ZodOptional<z.ZodArray<z.ZodString>>;
            environment: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            extensions: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>]>>;
        lsp: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<false>, z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodObject<{
            disabled: z.ZodLiteral<true>;
        }, z.core.$strip>, z.ZodObject<{
            command: z.ZodArray<z.ZodString>;
            extensions: z.ZodOptional<z.ZodArray<z.ZodString>>;
            disabled: z.ZodOptional<z.ZodBoolean>;
            env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            initialization: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.core.$strip>]>>]>>;
        instructions: z.ZodOptional<z.ZodArray<z.ZodString>>;
        layout: z.ZodOptional<z.ZodEnum<{
            auto: "auto";
            stretch: "stretch";
        }>>;
        permission: z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodUnion<[z.ZodObject<{
            __originalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
            read: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            edit: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            glob: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            grep: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            list: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            pyodide: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            task: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            external_directory: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            todowrite: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            todoread: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            question: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            webfetch: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            websearch: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            codesearch: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            lsp: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            doom_loop: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            skill: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
        }, z.core.$catchall<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>]>>>, z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>]>>, z.ZodTransform<Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">>, "allow" | "ask" | "deny" | {
            [x: string]: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">;
            __originalKeys?: string[] | undefined;
            read?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            edit?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            glob?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            grep?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            list?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            pyodide?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            task?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            external_directory?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            todowrite?: "allow" | "ask" | "deny" | undefined;
            todoread?: "allow" | "ask" | "deny" | undefined;
            question?: "allow" | "ask" | "deny" | undefined;
            webfetch?: "allow" | "ask" | "deny" | undefined;
            websearch?: "allow" | "ask" | "deny" | undefined;
            codesearch?: "allow" | "ask" | "deny" | undefined;
            lsp?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
            doom_loop?: "allow" | "ask" | "deny" | undefined;
            skill?: "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny"> | undefined;
        }>>>;
        tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        enterprise: z.ZodOptional<z.ZodObject<{
            url: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        compaction: z.ZodOptional<z.ZodObject<{
            auto: z.ZodOptional<z.ZodBoolean>;
            prune: z.ZodOptional<z.ZodBoolean>;
            reserved: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        experimental: z.ZodOptional<z.ZodObject<{
            disable_paste_summary: z.ZodOptional<z.ZodBoolean>;
            batch_tool: z.ZodOptional<z.ZodBoolean>;
            openTelemetry: z.ZodOptional<z.ZodBoolean>;
            primary_tools: z.ZodOptional<z.ZodArray<z.ZodString>>;
            continue_loop_on_deny: z.ZodOptional<z.ZodBoolean>;
            mcp_timeout: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strict>;
    type Info = z.output<typeof Info>;
    const global: {
        (): Promise<{
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                };
                build?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
                plan?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                };
                plan?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
                build?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
                general?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
                explore?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
                title?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
                summary?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
                compaction?: ({
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
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                } & {
                    options?: Record<string, unknown> | undefined;
                    permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                    steps?: number | undefined;
                }) | undefined;
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
            permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
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
        }>;
        reset: () => void;
    };
    const readFile: typeof ConfigPaths.readFile;
    const JsonError: {
        new (data: {
            path: string;
            message?: string | undefined;
        }, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "ConfigJsonError";
            readonly data: {
                path: string;
                message?: string | undefined;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ConfigJsonError">;
                data: z.ZodObject<{
                    path: z.ZodString;
                    message: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ConfigJsonError";
                data: {
                    path: string;
                    message?: string | undefined;
                };
            };
            message: string;
            stack?: string | undefined;
            readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
            readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
            readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
            readonly "~effect/Runtime/errorExitCode"?: number | undefined;
            readonly "~effect/Runtime/errorReported"?: boolean | undefined;
        };
        readonly Schema: z.ZodObject<{
            name: z.ZodLiteral<"ConfigJsonError">;
            data: z.ZodObject<{
                path: z.ZodString;
                message: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "ConfigJsonError";
            readonly data: {
                path: string;
                message?: string | undefined;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ConfigJsonError">;
                data: z.ZodObject<{
                    path: z.ZodString;
                    message: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ConfigJsonError";
                data: {
                    path: string;
                    message?: string | undefined;
                };
            };
            message: string;
            stack?: string | undefined;
            readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
            readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
            readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
            readonly "~effect/Runtime/errorExitCode"?: number | undefined;
            readonly "~effect/Runtime/errorReported"?: boolean | undefined;
        };
        isError(error: unknown): error is Error;
        isError(value: unknown): value is Error;
        prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
        captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
        captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
        stackTraceLimit: number;
        create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): {
            new (data: z.input<Data>, options?: ErrorOptions | undefined): {
                cause?: unknown;
                readonly name: Name;
                readonly data: z.input<Data>;
                schema(): z.ZodObject<{
                    name: z.ZodLiteral<Name>;
                    data: Data;
                }, z.core.$strip>;
                toObject(): {
                    name: Name;
                    data: z.input<Data>;
                };
                message: string;
                stack?: string | undefined;
                readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                readonly "~effect/Runtime/errorReported"?: boolean | undefined;
            };
            readonly Schema: z.ZodObject<{
                name: z.ZodLiteral<Name>;
                data: Data;
            }, z.core.$strip>;
            isInstance(input: any): input is {
                cause?: unknown;
                readonly name: Name;
                readonly data: z.input<Data>;
                schema(): z.ZodObject<{
                    name: z.ZodLiteral<Name>;
                    data: Data;
                }, z.core.$strip>;
                toObject(): {
                    name: Name;
                    data: z.input<Data>;
                };
                message: string;
                stack?: string | undefined;
                readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                readonly "~effect/Runtime/errorReported"?: boolean | undefined;
            };
            isError(error: unknown): error is Error;
            isError(value: unknown): value is Error;
            prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
            captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
            captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
            stackTraceLimit: number;
            create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): /*elided*/ any;
            readonly Unknown: {
                new (data: {
                    message: string;
                }, options?: ErrorOptions | undefined): {
                    cause?: unknown;
                    readonly name: "UnknownError";
                    readonly data: {
                        message: string;
                    };
                    schema(): z.ZodObject<{
                        name: z.ZodLiteral<"UnknownError">;
                        data: z.ZodObject<{
                            message: z.ZodString;
                        }, z.core.$strip>;
                    }, z.core.$strip>;
                    toObject(): {
                        name: "UnknownError";
                        data: {
                            message: string;
                        };
                    };
                    message: string;
                    stack?: string | undefined;
                    readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                    readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                    readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                    readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                    readonly "~effect/Runtime/errorReported"?: boolean | undefined;
                };
                readonly Schema: z.ZodObject<{
                    name: z.ZodLiteral<"UnknownError">;
                    data: z.ZodObject<{
                        message: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                isInstance(input: any): input is {
                    cause?: unknown;
                    readonly name: "UnknownError";
                    readonly data: {
                        message: string;
                    };
                    schema(): z.ZodObject<{
                        name: z.ZodLiteral<"UnknownError">;
                        data: z.ZodObject<{
                            message: z.ZodString;
                        }, z.core.$strip>;
                    }, z.core.$strip>;
                    toObject(): {
                        name: "UnknownError";
                        data: {
                            message: string;
                        };
                    };
                    message: string;
                    stack?: string | undefined;
                    readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                    readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                    readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                    readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                    readonly "~effect/Runtime/errorReported"?: boolean | undefined;
                };
                isError(error: unknown): error is Error;
                isError(value: unknown): value is Error;
                prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
                captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
                captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
                stackTraceLimit: number;
                create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): /*elided*/ any;
                readonly Unknown: /*elided*/ any;
            };
        };
        readonly Unknown: {
            new (data: {
                message: string;
            }, options?: ErrorOptions | undefined): {
                cause?: unknown;
                readonly name: "UnknownError";
                readonly data: {
                    message: string;
                };
                schema(): z.ZodObject<{
                    name: z.ZodLiteral<"UnknownError">;
                    data: z.ZodObject<{
                        message: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                toObject(): {
                    name: "UnknownError";
                    data: {
                        message: string;
                    };
                };
                message: string;
                stack?: string | undefined;
                readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                readonly "~effect/Runtime/errorReported"?: boolean | undefined;
            };
            readonly Schema: z.ZodObject<{
                name: z.ZodLiteral<"UnknownError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            isInstance(input: any): input is {
                cause?: unknown;
                readonly name: "UnknownError";
                readonly data: {
                    message: string;
                };
                schema(): z.ZodObject<{
                    name: z.ZodLiteral<"UnknownError">;
                    data: z.ZodObject<{
                        message: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                toObject(): {
                    name: "UnknownError";
                    data: {
                        message: string;
                    };
                };
                message: string;
                stack?: string | undefined;
                readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                readonly "~effect/Runtime/errorReported"?: boolean | undefined;
            };
            isError(error: unknown): error is Error;
            isError(value: unknown): value is Error;
            prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
            captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
            captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
            stackTraceLimit: number;
            create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): {
                new (data: z.input<Data>, options?: ErrorOptions | undefined): {
                    cause?: unknown;
                    readonly name: Name;
                    readonly data: z.input<Data>;
                    schema(): z.ZodObject<{
                        name: z.ZodLiteral<Name>;
                        data: Data;
                    }, z.core.$strip>;
                    toObject(): {
                        name: Name;
                        data: z.input<Data>;
                    };
                    message: string;
                    stack?: string | undefined;
                    readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                    readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                    readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                    readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                    readonly "~effect/Runtime/errorReported"?: boolean | undefined;
                };
                readonly Schema: z.ZodObject<{
                    name: z.ZodLiteral<Name>;
                    data: Data;
                }, z.core.$strip>;
                isInstance(input: any): input is {
                    cause?: unknown;
                    readonly name: Name;
                    readonly data: z.input<Data>;
                    schema(): z.ZodObject<{
                        name: z.ZodLiteral<Name>;
                        data: Data;
                    }, z.core.$strip>;
                    toObject(): {
                        name: Name;
                        data: z.input<Data>;
                    };
                    message: string;
                    stack?: string | undefined;
                    readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                    readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                    readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                    readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                    readonly "~effect/Runtime/errorReported"?: boolean | undefined;
                };
                isError(error: unknown): error is Error;
                isError(value: unknown): value is Error;
                prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
                captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
                captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
                stackTraceLimit: number;
                create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): /*elided*/ any;
                readonly Unknown: /*elided*/ any;
            };
            readonly Unknown: /*elided*/ any;
        };
    }, InvalidError: {
        new (data: {
            path: string;
            issues?: z.core.$ZodIssue[] | undefined;
            message?: string | undefined;
        }, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "ConfigInvalidError";
            readonly data: {
                path: string;
                issues?: z.core.$ZodIssue[] | undefined;
                message?: string | undefined;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ConfigInvalidError">;
                data: z.ZodObject<{
                    path: z.ZodString;
                    issues: z.ZodOptional<z.ZodCustom<z.core.$ZodIssue[], z.core.$ZodIssue[]>>;
                    message: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ConfigInvalidError";
                data: {
                    path: string;
                    issues?: z.core.$ZodIssue[] | undefined;
                    message?: string | undefined;
                };
            };
            message: string;
            stack?: string | undefined;
            readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
            readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
            readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
            readonly "~effect/Runtime/errorExitCode"?: number | undefined;
            readonly "~effect/Runtime/errorReported"?: boolean | undefined;
        };
        readonly Schema: z.ZodObject<{
            name: z.ZodLiteral<"ConfigInvalidError">;
            data: z.ZodObject<{
                path: z.ZodString;
                issues: z.ZodOptional<z.ZodCustom<z.core.$ZodIssue[], z.core.$ZodIssue[]>>;
                message: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "ConfigInvalidError";
            readonly data: {
                path: string;
                issues?: z.core.$ZodIssue[] | undefined;
                message?: string | undefined;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ConfigInvalidError">;
                data: z.ZodObject<{
                    path: z.ZodString;
                    issues: z.ZodOptional<z.ZodCustom<z.core.$ZodIssue[], z.core.$ZodIssue[]>>;
                    message: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ConfigInvalidError";
                data: {
                    path: string;
                    issues?: z.core.$ZodIssue[] | undefined;
                    message?: string | undefined;
                };
            };
            message: string;
            stack?: string | undefined;
            readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
            readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
            readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
            readonly "~effect/Runtime/errorExitCode"?: number | undefined;
            readonly "~effect/Runtime/errorReported"?: boolean | undefined;
        };
        isError(error: unknown): error is Error;
        isError(value: unknown): value is Error;
        prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
        captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
        captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
        stackTraceLimit: number;
        create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): {
            new (data: z.input<Data>, options?: ErrorOptions | undefined): {
                cause?: unknown;
                readonly name: Name;
                readonly data: z.input<Data>;
                schema(): z.ZodObject<{
                    name: z.ZodLiteral<Name>;
                    data: Data;
                }, z.core.$strip>;
                toObject(): {
                    name: Name;
                    data: z.input<Data>;
                };
                message: string;
                stack?: string | undefined;
                readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                readonly "~effect/Runtime/errorReported"?: boolean | undefined;
            };
            readonly Schema: z.ZodObject<{
                name: z.ZodLiteral<Name>;
                data: Data;
            }, z.core.$strip>;
            isInstance(input: any): input is {
                cause?: unknown;
                readonly name: Name;
                readonly data: z.input<Data>;
                schema(): z.ZodObject<{
                    name: z.ZodLiteral<Name>;
                    data: Data;
                }, z.core.$strip>;
                toObject(): {
                    name: Name;
                    data: z.input<Data>;
                };
                message: string;
                stack?: string | undefined;
                readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                readonly "~effect/Runtime/errorReported"?: boolean | undefined;
            };
            isError(error: unknown): error is Error;
            isError(value: unknown): value is Error;
            prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
            captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
            captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
            stackTraceLimit: number;
            create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): /*elided*/ any;
            readonly Unknown: {
                new (data: {
                    message: string;
                }, options?: ErrorOptions | undefined): {
                    cause?: unknown;
                    readonly name: "UnknownError";
                    readonly data: {
                        message: string;
                    };
                    schema(): z.ZodObject<{
                        name: z.ZodLiteral<"UnknownError">;
                        data: z.ZodObject<{
                            message: z.ZodString;
                        }, z.core.$strip>;
                    }, z.core.$strip>;
                    toObject(): {
                        name: "UnknownError";
                        data: {
                            message: string;
                        };
                    };
                    message: string;
                    stack?: string | undefined;
                    readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                    readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                    readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                    readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                    readonly "~effect/Runtime/errorReported"?: boolean | undefined;
                };
                readonly Schema: z.ZodObject<{
                    name: z.ZodLiteral<"UnknownError">;
                    data: z.ZodObject<{
                        message: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                isInstance(input: any): input is {
                    cause?: unknown;
                    readonly name: "UnknownError";
                    readonly data: {
                        message: string;
                    };
                    schema(): z.ZodObject<{
                        name: z.ZodLiteral<"UnknownError">;
                        data: z.ZodObject<{
                            message: z.ZodString;
                        }, z.core.$strip>;
                    }, z.core.$strip>;
                    toObject(): {
                        name: "UnknownError";
                        data: {
                            message: string;
                        };
                    };
                    message: string;
                    stack?: string | undefined;
                    readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                    readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                    readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                    readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                    readonly "~effect/Runtime/errorReported"?: boolean | undefined;
                };
                isError(error: unknown): error is Error;
                isError(value: unknown): value is Error;
                prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
                captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
                captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
                stackTraceLimit: number;
                create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): /*elided*/ any;
                readonly Unknown: /*elided*/ any;
            };
        };
        readonly Unknown: {
            new (data: {
                message: string;
            }, options?: ErrorOptions | undefined): {
                cause?: unknown;
                readonly name: "UnknownError";
                readonly data: {
                    message: string;
                };
                schema(): z.ZodObject<{
                    name: z.ZodLiteral<"UnknownError">;
                    data: z.ZodObject<{
                        message: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                toObject(): {
                    name: "UnknownError";
                    data: {
                        message: string;
                    };
                };
                message: string;
                stack?: string | undefined;
                readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                readonly "~effect/Runtime/errorReported"?: boolean | undefined;
            };
            readonly Schema: z.ZodObject<{
                name: z.ZodLiteral<"UnknownError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            isInstance(input: any): input is {
                cause?: unknown;
                readonly name: "UnknownError";
                readonly data: {
                    message: string;
                };
                schema(): z.ZodObject<{
                    name: z.ZodLiteral<"UnknownError">;
                    data: z.ZodObject<{
                        message: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                toObject(): {
                    name: "UnknownError";
                    data: {
                        message: string;
                    };
                };
                message: string;
                stack?: string | undefined;
                readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                readonly "~effect/Runtime/errorReported"?: boolean | undefined;
            };
            isError(error: unknown): error is Error;
            isError(value: unknown): value is Error;
            prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
            captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
            captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
            stackTraceLimit: number;
            create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): {
                new (data: z.input<Data>, options?: ErrorOptions | undefined): {
                    cause?: unknown;
                    readonly name: Name;
                    readonly data: z.input<Data>;
                    schema(): z.ZodObject<{
                        name: z.ZodLiteral<Name>;
                        data: Data;
                    }, z.core.$strip>;
                    toObject(): {
                        name: Name;
                        data: z.input<Data>;
                    };
                    message: string;
                    stack?: string | undefined;
                    readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                    readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                    readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                    readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                    readonly "~effect/Runtime/errorReported"?: boolean | undefined;
                };
                readonly Schema: z.ZodObject<{
                    name: z.ZodLiteral<Name>;
                    data: Data;
                }, z.core.$strip>;
                isInstance(input: any): input is {
                    cause?: unknown;
                    readonly name: Name;
                    readonly data: z.input<Data>;
                    schema(): z.ZodObject<{
                        name: z.ZodLiteral<Name>;
                        data: Data;
                    }, z.core.$strip>;
                    toObject(): {
                        name: Name;
                        data: z.input<Data>;
                    };
                    message: string;
                    stack?: string | undefined;
                    readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                    readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                    readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                    readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                    readonly "~effect/Runtime/errorReported"?: boolean | undefined;
                };
                isError(error: unknown): error is Error;
                isError(value: unknown): value is Error;
                prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
                captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
                captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
                stackTraceLimit: number;
                create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): /*elided*/ any;
                readonly Unknown: /*elided*/ any;
            };
            readonly Unknown: /*elided*/ any;
        };
    };
    const ConfigDirectoryTypoError: {
        new (data: {
            path: string;
            dir: string;
            suggestion: string;
        }, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "ConfigDirectoryTypoError";
            readonly data: {
                path: string;
                dir: string;
                suggestion: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ConfigDirectoryTypoError">;
                data: z.ZodObject<{
                    path: z.ZodString;
                    dir: z.ZodString;
                    suggestion: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ConfigDirectoryTypoError";
                data: {
                    path: string;
                    dir: string;
                    suggestion: string;
                };
            };
            message: string;
            stack?: string | undefined;
            readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
            readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
            readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
            readonly "~effect/Runtime/errorExitCode"?: number | undefined;
            readonly "~effect/Runtime/errorReported"?: boolean | undefined;
        };
        readonly Schema: z.ZodObject<{
            name: z.ZodLiteral<"ConfigDirectoryTypoError">;
            data: z.ZodObject<{
                path: z.ZodString;
                dir: z.ZodString;
                suggestion: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "ConfigDirectoryTypoError";
            readonly data: {
                path: string;
                dir: string;
                suggestion: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ConfigDirectoryTypoError">;
                data: z.ZodObject<{
                    path: z.ZodString;
                    dir: z.ZodString;
                    suggestion: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ConfigDirectoryTypoError";
                data: {
                    path: string;
                    dir: string;
                    suggestion: string;
                };
            };
            message: string;
            stack?: string | undefined;
            readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
            readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
            readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
            readonly "~effect/Runtime/errorExitCode"?: number | undefined;
            readonly "~effect/Runtime/errorReported"?: boolean | undefined;
        };
        isError(error: unknown): error is Error;
        isError(value: unknown): value is Error;
        prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
        captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
        captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
        stackTraceLimit: number;
        create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): {
            new (data: z.input<Data>, options?: ErrorOptions | undefined): {
                cause?: unknown;
                readonly name: Name;
                readonly data: z.input<Data>;
                schema(): z.ZodObject<{
                    name: z.ZodLiteral<Name>;
                    data: Data;
                }, z.core.$strip>;
                toObject(): {
                    name: Name;
                    data: z.input<Data>;
                };
                message: string;
                stack?: string | undefined;
                readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                readonly "~effect/Runtime/errorReported"?: boolean | undefined;
            };
            readonly Schema: z.ZodObject<{
                name: z.ZodLiteral<Name>;
                data: Data;
            }, z.core.$strip>;
            isInstance(input: any): input is {
                cause?: unknown;
                readonly name: Name;
                readonly data: z.input<Data>;
                schema(): z.ZodObject<{
                    name: z.ZodLiteral<Name>;
                    data: Data;
                }, z.core.$strip>;
                toObject(): {
                    name: Name;
                    data: z.input<Data>;
                };
                message: string;
                stack?: string | undefined;
                readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                readonly "~effect/Runtime/errorReported"?: boolean | undefined;
            };
            isError(error: unknown): error is Error;
            isError(value: unknown): value is Error;
            prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
            captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
            captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
            stackTraceLimit: number;
            create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): /*elided*/ any;
            readonly Unknown: {
                new (data: {
                    message: string;
                }, options?: ErrorOptions | undefined): {
                    cause?: unknown;
                    readonly name: "UnknownError";
                    readonly data: {
                        message: string;
                    };
                    schema(): z.ZodObject<{
                        name: z.ZodLiteral<"UnknownError">;
                        data: z.ZodObject<{
                            message: z.ZodString;
                        }, z.core.$strip>;
                    }, z.core.$strip>;
                    toObject(): {
                        name: "UnknownError";
                        data: {
                            message: string;
                        };
                    };
                    message: string;
                    stack?: string | undefined;
                    readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                    readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                    readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                    readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                    readonly "~effect/Runtime/errorReported"?: boolean | undefined;
                };
                readonly Schema: z.ZodObject<{
                    name: z.ZodLiteral<"UnknownError">;
                    data: z.ZodObject<{
                        message: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                isInstance(input: any): input is {
                    cause?: unknown;
                    readonly name: "UnknownError";
                    readonly data: {
                        message: string;
                    };
                    schema(): z.ZodObject<{
                        name: z.ZodLiteral<"UnknownError">;
                        data: z.ZodObject<{
                            message: z.ZodString;
                        }, z.core.$strip>;
                    }, z.core.$strip>;
                    toObject(): {
                        name: "UnknownError";
                        data: {
                            message: string;
                        };
                    };
                    message: string;
                    stack?: string | undefined;
                    readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                    readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                    readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                    readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                    readonly "~effect/Runtime/errorReported"?: boolean | undefined;
                };
                isError(error: unknown): error is Error;
                isError(value: unknown): value is Error;
                prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
                captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
                captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
                stackTraceLimit: number;
                create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): /*elided*/ any;
                readonly Unknown: /*elided*/ any;
            };
        };
        readonly Unknown: {
            new (data: {
                message: string;
            }, options?: ErrorOptions | undefined): {
                cause?: unknown;
                readonly name: "UnknownError";
                readonly data: {
                    message: string;
                };
                schema(): z.ZodObject<{
                    name: z.ZodLiteral<"UnknownError">;
                    data: z.ZodObject<{
                        message: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                toObject(): {
                    name: "UnknownError";
                    data: {
                        message: string;
                    };
                };
                message: string;
                stack?: string | undefined;
                readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                readonly "~effect/Runtime/errorReported"?: boolean | undefined;
            };
            readonly Schema: z.ZodObject<{
                name: z.ZodLiteral<"UnknownError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            isInstance(input: any): input is {
                cause?: unknown;
                readonly name: "UnknownError";
                readonly data: {
                    message: string;
                };
                schema(): z.ZodObject<{
                    name: z.ZodLiteral<"UnknownError">;
                    data: z.ZodObject<{
                        message: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                toObject(): {
                    name: "UnknownError";
                    data: {
                        message: string;
                    };
                };
                message: string;
                stack?: string | undefined;
                readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                readonly "~effect/Runtime/errorReported"?: boolean | undefined;
            };
            isError(error: unknown): error is Error;
            isError(value: unknown): value is Error;
            prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
            captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
            captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
            stackTraceLimit: number;
            create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): {
                new (data: z.input<Data>, options?: ErrorOptions | undefined): {
                    cause?: unknown;
                    readonly name: Name;
                    readonly data: z.input<Data>;
                    schema(): z.ZodObject<{
                        name: z.ZodLiteral<Name>;
                        data: Data;
                    }, z.core.$strip>;
                    toObject(): {
                        name: Name;
                        data: z.input<Data>;
                    };
                    message: string;
                    stack?: string | undefined;
                    readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                    readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                    readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                    readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                    readonly "~effect/Runtime/errorReported"?: boolean | undefined;
                };
                readonly Schema: z.ZodObject<{
                    name: z.ZodLiteral<Name>;
                    data: Data;
                }, z.core.$strip>;
                isInstance(input: any): input is {
                    cause?: unknown;
                    readonly name: Name;
                    readonly data: z.input<Data>;
                    schema(): z.ZodObject<{
                        name: z.ZodLiteral<Name>;
                        data: Data;
                    }, z.core.$strip>;
                    toObject(): {
                        name: Name;
                        data: z.input<Data>;
                    };
                    message: string;
                    stack?: string | undefined;
                    readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                    readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                    readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                    readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                    readonly "~effect/Runtime/errorReported"?: boolean | undefined;
                };
                isError(error: unknown): error is Error;
                isError(value: unknown): value is Error;
                prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
                captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
                captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
                stackTraceLimit: number;
                create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): /*elided*/ any;
                readonly Unknown: /*elided*/ any;
            };
            readonly Unknown: /*elided*/ any;
        };
    };
    function get(): Promise<{
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            };
            build?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
            plan?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            };
            plan?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
            build?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
            general?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
            explore?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
            title?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
            summary?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
            compaction?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
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
        permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
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
    }>;
    function getGlobal(): Promise<{
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            };
            build?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
            plan?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            };
            plan?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
            build?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
            general?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
            explore?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
            title?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
            summary?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
            compaction?: ({
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
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
            } & {
                options?: Record<string, unknown> | undefined;
                permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
                steps?: number | undefined;
            }) | undefined;
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
        permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">> | undefined;
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
    }>;
    function update(config: Info): Promise<void>;
    function updateGlobal(config: Info): Promise<{
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
    }>;
    function directories(): Promise<any[]>;
}
