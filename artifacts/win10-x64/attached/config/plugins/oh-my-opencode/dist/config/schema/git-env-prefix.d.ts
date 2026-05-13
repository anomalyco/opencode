import { z } from "zod";
export declare const GIT_ENV_PREFIX_VALIDATION_MESSAGE = "git_env_prefix must be empty or use shell-safe env assignments like \"GIT_MASTER=1\"";
export declare function isValidGitEnvPrefix(value: string): boolean;
export declare function assertValidGitEnvPrefix(value: string): string;
export declare const GitEnvPrefixSchema: z.ZodDefault<z.ZodString>;
