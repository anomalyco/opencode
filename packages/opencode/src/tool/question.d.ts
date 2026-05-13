import z from "zod";
import { Tool } from "./tool";
export declare const QuestionTool: Tool.Info<z.ZodObject<{
    questions: z.ZodArray<z.ZodObject<{
        question: z.ZodString;
        header: z.ZodString;
        options: z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            description: z.ZodString;
        }, z.core.$strip>>;
        multiple: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strip>, {
    answers: string[][];
}>;
