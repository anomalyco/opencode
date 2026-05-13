import z from "zod";
import { Tool } from "./tool";
import { Log } from "../util/log";
export declare const log: Log.Logger;
export declare const PyodideTool: Tool.Info<z.ZodObject<{
    code: z.ZodString;
    timeout: z.ZodOptional<z.ZodNumber>;
    workdir: z.ZodOptional<z.ZodString>;
    description: z.ZodString;
}, z.core.$strip>, {
    output: any;
    exit: any;
    description: string;
}>;
