export declare const GPT_APPLY_PATCH_GUIDANCE = "Use the `edit` and `write` tools for file changes. Do not use `apply_patch` on GPT models - it is unreliable here and can hang during verification.";
export declare function getGptApplyPatchPermission(model: string): Record<string, "deny">;
