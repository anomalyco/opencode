import type { BuiltinSkill } from "../types";
/**
 * Playwright CLI skill - token-efficient CLI alternative to the MCP-based playwright skill.
 *
 * Uses name "playwright" (not "playwright-cli") because agents hardcode "playwright" as the
 * canonical browser skill name. The browserProvider config swaps the implementation behind
 * the same name: "playwright" gives MCP, "playwright-cli" gives this CLI variant.
 * The binary is still called `playwright-cli` (see allowedTools).
 */
export declare const playwrightCliSkill: BuiltinSkill;
