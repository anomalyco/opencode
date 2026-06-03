import { z } from "zod";
export declare const SkillSourceSchema: z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
    path: z.ZodString;
    recursive: z.ZodOptional<z.ZodBoolean>;
    glob: z.ZodOptional<z.ZodString>;
}, z.core.$strip>]>;
export declare const SkillDefinitionSchema: z.ZodObject<{
    description: z.ZodOptional<z.ZodString>;
    template: z.ZodOptional<z.ZodString>;
    from: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    agent: z.ZodOptional<z.ZodString>;
    subtask: z.ZodOptional<z.ZodBoolean>;
    "argument-hint": z.ZodOptional<z.ZodString>;
    license: z.ZodOptional<z.ZodString>;
    compatibility: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    "allowed-tools": z.ZodOptional<z.ZodArray<z.ZodString>>;
    disable: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const SkillEntrySchema: z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
    description: z.ZodOptional<z.ZodString>;
    template: z.ZodOptional<z.ZodString>;
    from: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    agent: z.ZodOptional<z.ZodString>;
    subtask: z.ZodOptional<z.ZodBoolean>;
    "argument-hint": z.ZodOptional<z.ZodString>;
    license: z.ZodOptional<z.ZodString>;
    compatibility: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    "allowed-tools": z.ZodOptional<z.ZodArray<z.ZodString>>;
    disable: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>]>;
export declare const SkillsConfigSchema: z.ZodUnion<readonly [z.ZodArray<z.ZodString>, z.ZodObject<{
    sources: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        path: z.ZodString;
        recursive: z.ZodOptional<z.ZodBoolean>;
        glob: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>]>>>;
    enable: z.ZodOptional<z.ZodArray<z.ZodString>>;
    disable: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$catchall<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
    description: z.ZodOptional<z.ZodString>;
    template: z.ZodOptional<z.ZodString>;
    from: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    agent: z.ZodOptional<z.ZodString>;
    subtask: z.ZodOptional<z.ZodBoolean>;
    "argument-hint": z.ZodOptional<z.ZodString>;
    license: z.ZodOptional<z.ZodString>;
    compatibility: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    "allowed-tools": z.ZodOptional<z.ZodArray<z.ZodString>>;
    disable: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>]>>>]>;
export type SkillsConfig = z.infer<typeof SkillsConfigSchema>;
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;
