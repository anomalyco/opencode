import z from "zod";
import { SessionID } from "./schema";
import { Session } from ".";
export declare namespace SessionRevert {
    const RevertInput: z.ZodObject<{
        sessionID: any;
        messageID: any;
        partID: any;
    }, z.core.$strip>;
    type RevertInput = z.infer<typeof RevertInput>;
    function revert(input: RevertInput): Promise<any>;
    function unrevert(input: {
        sessionID: SessionID;
    }): Promise<any>;
    function cleanup(session: Session.Info): Promise<void>;
}
