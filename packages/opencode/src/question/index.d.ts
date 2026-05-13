import { SessionID, MessageID } from "@/session/schema";
import z from "zod";
export declare namespace Question {
    const Option: z.ZodObject<{
        label: z.ZodString;
        description: z.ZodString;
    }, z.core.$strip>;
    type Option = z.infer<typeof Option>;
    const Info: z.ZodObject<{
        question: z.ZodString;
        header: z.ZodString;
        options: z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            description: z.ZodString;
        }, z.core.$strip>>;
        multiple: z.ZodOptional<z.ZodBoolean>;
        custom: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    type Info = z.infer<typeof Info>;
    const Request: z.ZodObject<{
        id: any;
        sessionID: any;
        questions: z.ZodArray<z.ZodObject<{
            question: z.ZodString;
            header: z.ZodString;
            options: z.ZodArray<z.ZodObject<{
                label: z.ZodString;
                description: z.ZodString;
            }, z.core.$strip>>;
            multiple: z.ZodOptional<z.ZodBoolean>;
            custom: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
        tool: z.ZodOptional<z.ZodObject<{
            messageID: any;
            callID: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    type Request = z.infer<typeof Request>;
    const Answer: z.ZodArray<z.ZodString>;
    type Answer = z.infer<typeof Answer>;
    const Reply: z.ZodObject<{
        answers: z.ZodArray<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
    type Reply = z.infer<typeof Reply>;
    const Event: {
        Asked: any;
        Replied: any;
        Rejected: any;
    };
    function ask(input: {
        sessionID: SessionID;
        questions: Info[];
        tool?: {
            messageID: MessageID;
            callID: string;
        };
    }): Promise<Answer[]>;
    function reply(input: {
        requestID: string;
        answers: Answer[];
    }): Promise<void>;
    function reject(requestID: string): Promise<void>;
    class RejectedError extends Error {
        constructor();
    }
    function list(): Promise<any>;
}
