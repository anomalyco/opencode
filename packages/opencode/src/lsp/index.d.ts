import { LSPClient } from "./client";
import { LSPServer } from "./server";
import z from "zod";
export declare namespace LSP {
    const Event: {
        Updated: any;
    };
    const Range: z.ZodObject<{
        start: z.ZodObject<{
            line: z.ZodNumber;
            character: z.ZodNumber;
        }, z.core.$strip>;
        end: z.ZodObject<{
            line: z.ZodNumber;
            character: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>;
    type Range = z.infer<typeof Range>;
    const Symbol: z.ZodObject<{
        name: z.ZodString;
        kind: z.ZodNumber;
        location: z.ZodObject<{
            uri: z.ZodString;
            range: z.ZodObject<{
                start: z.ZodObject<{
                    line: z.ZodNumber;
                    character: z.ZodNumber;
                }, z.core.$strip>;
                end: z.ZodObject<{
                    line: z.ZodNumber;
                    character: z.ZodNumber;
                }, z.core.$strip>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    type Symbol = z.infer<typeof Symbol>;
    const DocumentSymbol: z.ZodObject<{
        name: z.ZodString;
        detail: z.ZodOptional<z.ZodString>;
        kind: z.ZodNumber;
        range: z.ZodObject<{
            start: z.ZodObject<{
                line: z.ZodNumber;
                character: z.ZodNumber;
            }, z.core.$strip>;
            end: z.ZodObject<{
                line: z.ZodNumber;
                character: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
        selectionRange: z.ZodObject<{
            start: z.ZodObject<{
                line: z.ZodNumber;
                character: z.ZodNumber;
            }, z.core.$strip>;
            end: z.ZodObject<{
                line: z.ZodNumber;
                character: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    type DocumentSymbol = z.infer<typeof DocumentSymbol>;
    function init(): Promise<{
        broken: Set<string>;
        servers: Record<string, LSPServer.Info>;
        clients: {
            root: string;
            readonly serverID: string;
            readonly connection: import("vscode-jsonrpc").MessageConnection;
            notify: {
                open(input: {
                    path: string;
                }): Promise<void>;
            };
            readonly diagnostics: Map<string, import("vscode-languageserver-types").Diagnostic[]>;
            waitForDiagnostics(input: {
                path: string;
            }): Promise<void>;
            shutdown(): Promise<void>;
        }[];
        spawning: Map<string, Promise<{
            root: string;
            readonly serverID: string;
            readonly connection: import("vscode-jsonrpc").MessageConnection;
            notify: {
                open(input: {
                    path: string;
                }): Promise<void>;
            };
            readonly diagnostics: Map<string, import("vscode-languageserver-types").Diagnostic[]>;
            waitForDiagnostics(input: {
                path: string;
            }): Promise<void>;
            shutdown(): Promise<void>;
        } | undefined>>;
    }>;
    const Status: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        root: z.ZodString;
        status: z.ZodUnion<readonly [z.ZodLiteral<"connected">, z.ZodLiteral<"error">]>;
    }, z.core.$strip>;
    type Status = z.infer<typeof Status>;
    function status(): Promise<{
        id: string;
        name: string;
        root: string;
        status: "connected" | "error";
    }[]>;
    function hasClients(file: string): Promise<boolean>;
    function touchFile(input: string, waitForDiagnostics?: boolean): Promise<void>;
    function diagnostics(): Promise<Record<string, import("vscode-languageserver-types").Diagnostic[]>>;
    function hover(input: {
        file: string;
        line: number;
        character: number;
    }): Promise<unknown[]>;
    function workspaceSymbol(query: string): Promise<{
        name: string;
        kind: number;
        location: {
            uri: string;
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
        };
    }[]>;
    function documentSymbol(uri: string): Promise<({
        name: string;
        kind: number;
        location: {
            uri: string;
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
        };
    } | {
        name: string;
        detail?: string | undefined;
        kind: number;
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
        selectionRange: {
            start: {
                line: number;
                character: number;
            };
            end: {
                line: number;
                character: number;
            };
        };
    })[]>;
    function definition(input: {
        file: string;
        line: number;
        character: number;
    }): Promise<unknown[]>;
    function references(input: {
        file: string;
        line: number;
        character: number;
    }): Promise<unknown[]>;
    function implementation(input: {
        file: string;
        line: number;
        character: number;
    }): Promise<unknown[]>;
    function prepareCallHierarchy(input: {
        file: string;
        line: number;
        character: number;
    }): Promise<unknown[]>;
    function incomingCalls(input: {
        file: string;
        line: number;
        character: number;
    }): Promise<unknown[]>;
    function outgoingCalls(input: {
        file: string;
        line: number;
        character: number;
    }): Promise<unknown[]>;
    namespace Diagnostic {
        function pretty(diagnostic: LSPClient.Diagnostic): string;
    }
}
