import z from "zod";
export declare const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key";
export declare namespace Auth {
    const Oauth: z.ZodObject<{
        type: z.ZodLiteral<"oauth">;
        refresh: z.ZodString;
        access: z.ZodString;
        expires: z.ZodNumber;
        accountId: z.ZodOptional<z.ZodString>;
        enterpriseUrl: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    const Api: z.ZodObject<{
        type: z.ZodLiteral<"api">;
        key: z.ZodString;
    }, z.core.$strip>;
    const WellKnown: z.ZodObject<{
        type: z.ZodLiteral<"wellknown">;
        key: z.ZodString;
        token: z.ZodString;
    }, z.core.$strip>;
    const Info: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"oauth">;
        refresh: z.ZodString;
        access: z.ZodString;
        expires: z.ZodNumber;
        accountId: z.ZodOptional<z.ZodString>;
        enterpriseUrl: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"api">;
        key: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"wellknown">;
        key: z.ZodString;
        token: z.ZodString;
    }, z.core.$strip>], "type">;
    type Info = z.infer<typeof Info>;
    function get(providerID: string): Promise<{
        type: "oauth";
        refresh: string;
        access: string;
        expires: number;
        accountId?: string | undefined;
        enterpriseUrl?: string | undefined;
    } | {
        type: "api";
        key: string;
    } | {
        type: "wellknown";
        key: string;
        token: string;
    }>;
    function all(): Promise<Record<string, Info>>;
    function set(key: string, info: Info): Promise<void>;
    function remove(key: string): Promise<void>;
}
