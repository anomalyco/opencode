import type { Agent } from "../agent/agent";
import { Tool } from "./tool";
import z from "zod";
export declare namespace ToolRegistry {
    const state: () => Promise<{
        custom: Tool.Info<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>, Metadata>[];
    }>;
    function register(tool: Tool.Info): Promise<void>;
    function ids(): Promise<string[]>;
    function tools(model: {
        providerID: string;
        modelID: string;
    }, agent?: Agent.Info): Promise<{
        execute(args: unknown, ctx: Tool.Context<Metadata>): Promise<{
            title: string;
            metadata: Metadata;
            output: string;
            attachments?: Omit<{
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
            }, "id" | "messageID" | "sessionID">[] | undefined;
        }>;
        formatValidationError?(error: z.ZodError<unknown>): string;
        id: string;
        description: string;
        parameters: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
    }[]>;
}
