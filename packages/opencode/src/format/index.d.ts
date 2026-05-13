import z from "zod";
export declare namespace Format {
    const Status: z.ZodObject<{
        name: z.ZodString;
        extensions: z.ZodArray<z.ZodString>;
        enabled: z.ZodBoolean;
    }, z.core.$strip>;
    type Status = z.infer<typeof Status>;
    function status(): Promise<{
        name: string;
        extensions: string[];
        enabled: boolean;
    }[]>;
    function init(): void;
}
