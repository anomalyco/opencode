import type { BackgroundManager } from "../../features/background-agent";
export type BackgroundOutputMessage = {
    id?: string;
    info?: {
        role?: string;
        time?: string | {
            created?: number;
        };
        agent?: string;
    };
    parts?: Array<{
        type?: string;
        text?: string;
        thinking?: string;
        content?: string | Array<{
            type: string;
            text?: string;
        }>;
        output?: string;
        name?: string;
    }>;
};
export type BackgroundOutputMessagesResult = {
    data?: BackgroundOutputMessage[];
    error?: unknown;
} | BackgroundOutputMessage[];
export type BackgroundOutputClient = {
    session: {
        messages: (args: {
            path: {
                id: string;
            };
        }) => Promise<BackgroundOutputMessagesResult>;
    };
};
export type BackgroundCancelClient = {
    session: {
        abort: (args: {
            path: {
                id: string;
            };
        }) => Promise<unknown>;
    };
};
export type BackgroundOutputManager = Pick<BackgroundManager, "getTask">;
