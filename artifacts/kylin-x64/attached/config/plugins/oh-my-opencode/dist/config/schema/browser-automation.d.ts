import { z } from "zod";
export declare const BrowserAutomationProviderSchema: z.ZodEnum<{
    playwright: "playwright";
    "agent-browser": "agent-browser";
    "dev-browser": "dev-browser";
    "playwright-cli": "playwright-cli";
}>;
export declare const BrowserAutomationConfigSchema: z.ZodObject<{
    provider: z.ZodDefault<z.ZodEnum<{
        playwright: "playwright";
        "agent-browser": "agent-browser";
        "dev-browser": "dev-browser";
        "playwright-cli": "playwright-cli";
    }>>;
}, z.core.$strip>;
export type BrowserAutomationProvider = z.infer<typeof BrowserAutomationProviderSchema>;
export type BrowserAutomationConfig = z.infer<typeof BrowserAutomationConfigSchema>;
