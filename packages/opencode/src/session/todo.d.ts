import { SessionID } from "./schema";
import z from "zod";
export declare namespace Todo {
    const Info: z.ZodObject<{
        content: z.ZodString;
        status: z.ZodString;
        priority: z.ZodString;
    }, z.core.$strip>;
    type Info = z.infer<typeof Info>;
    const Event: {
        Updated: any;
    };
    function update(input: {
        sessionID: SessionID;
        todos: Info[];
    }): Promise<void>;
    function get(sessionID: SessionID): Promise<{
        content: any;
        status: any;
        priority: any;
    }[]>;
}
