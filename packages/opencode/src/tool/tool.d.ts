import z from "zod";
import type { MessageV2 } from "../session/message-v2";
import type { Agent } from "../agent/agent";
import type { PermissionNext } from "../permission/next";
import type { SessionID, MessageID } from "../session/schema";
export declare namespace Tool {
    interface Metadata {
        [key: string]: any;
    }
    export interface InitContext {
        agent?: Agent.Info;
    }
    export type Context<M extends Metadata = Metadata> = {
        sessionID: SessionID;
        messageID: MessageID;
        agent: string;
        abort: AbortSignal;
        callID?: string;
        extra?: {
            [key: string]: any;
        };
        messages: MessageV2.WithParts[];
        metadata(input: {
            title?: string;
            metadata?: M;
        }): void;
        ask(input: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">): Promise<void>;
    };
    export interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
        id: string;
        init: (ctx?: InitContext) => Promise<{
            description: string;
            parameters: Parameters;
            execute(args: z.infer<Parameters>, ctx: Context): Promise<{
                title: string;
                metadata: M;
                output: string;
                attachments?: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[];
            }>;
            formatValidationError?(error: z.ZodError): string;
        }>;
    }
    export type InferParameters<T extends Info> = T extends Info<infer P> ? z.infer<P> : never;
    export type InferMetadata<T extends Info> = T extends Info<any, infer M> ? M : never;
    export function define<Parameters extends z.ZodType, Result extends Metadata>(id: string, init: Info<Parameters, Result>["init"] | Awaited<ReturnType<Info<Parameters, Result>["init"]>>): Info<Parameters, Result>;
    export {};
}
