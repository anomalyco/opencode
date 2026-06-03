/**
 * Environment variable registry
 *
 * Usage:
 * ```ts
 * import { registerEnvVar, env } from "./lib/env.ts";
 *
 * // Register environment variables
 * registerEnvVar({
 *   name: "DEBUG",
 *   description: "Enable debug logging",
 *   type: "boolean",
 *   default: false
 * });
 *
 * registerEnvVar({
 *   name: "PORT",
 *   description: "Server port number",
 *   type: "number",
 *   default: 3000
 * });
 *
 * // Access environment variables
 * if (env.DEBUG) {
 *   console.log("Debug mode enabled");
 * }
 *
 * const port = env.PORT; // number
 * ```
 */
export interface EnvVarConfig {
    name: string;
    description: string;
    default?: string | boolean | number;
    type?: "string" | "boolean" | "number";
}
export declare const envRegistry: Record<string, EnvVarConfig>;
export declare function registerEnvVar(config: EnvVarConfig): void;
export declare function clearEnvCache(): void;
export declare function generateEnvMarkdown(): string;
export declare function generateEnvColored(): string;
export declare const env: Record<string, any>;
