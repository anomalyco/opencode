import { Config } from "@/config/config";
import z from "zod";
export declare namespace PermissionNext {
    const Action: z.ZodEnum<{
        allow: "allow";
        ask: "ask";
        deny: "deny";
    }>;
    type Action = z.infer<typeof Action>;
    const Rule: z.ZodObject<{
        permission: z.ZodString;
        pattern: z.ZodString;
        action: z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>;
    }, z.core.$strip>;
    type Rule = z.infer<typeof Rule>;
    const Ruleset: z.ZodArray<z.ZodObject<{
        permission: z.ZodString;
        pattern: z.ZodString;
        action: z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>;
    }, z.core.$strip>>;
    type Ruleset = z.infer<typeof Ruleset>;
    function fromConfig(permission: Config.Permission): {
        permission: string;
        pattern: string;
        action: "allow" | "ask" | "deny";
    }[];
    function merge(...rulesets: Ruleset[]): Ruleset;
    const Request: z.ZodObject<{
        id: any;
        sessionID: any;
        permission: z.ZodString;
        patterns: z.ZodArray<z.ZodString>;
        metadata: z.ZodRecord<z.ZodString, z.ZodAny>;
        always: z.ZodArray<z.ZodString>;
        tool: z.ZodOptional<z.ZodObject<{
            messageID: any;
            callID: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    type Request = z.infer<typeof Request>;
    const Reply: z.ZodEnum<{
        always: "always";
        once: "once";
        reject: "reject";
    }>;
    type Reply = z.infer<typeof Reply>;
    const Approval: z.ZodObject<{
        projectID: any;
        patterns: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    const Event: {
        Asked: any;
        Replied: any;
    };
    const ask: any;
    const reply: any;
    function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule;
    function disabled(tools: string[], ruleset: Ruleset): Set<string>;
    /** User rejected without message - halts execution */
    class RejectedError extends Error {
        constructor();
    }
    /** User rejected with message - continues with guidance */
    class CorrectedError extends Error {
        constructor(message: string);
    }
    /** Auto-rejected by config rule - halts execution */
    class DeniedError extends Error {
        readonly ruleset: Ruleset;
        constructor(ruleset: Ruleset);
    }
    function list(): Promise<any[]>;
}
