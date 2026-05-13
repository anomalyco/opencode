import { SessionID } from "./schema";
import z from "zod";
export declare namespace SessionStatus {
    const Info: z.ZodUnion<readonly [z.ZodObject<{
        type: z.ZodLiteral<"idle">;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"retry">;
        attempt: z.ZodNumber;
        message: z.ZodString;
        next: z.ZodNumber;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"busy">;
    }, z.core.$strip>]>;
    type Info = z.infer<typeof Info>;
    const Event: {
        Status: any;
        Idle: any;
    };
    function get(sessionID: SessionID): any;
    function list(): any;
    function set(sessionID: SessionID, status: Info): void;
}
