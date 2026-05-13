/**
 * GPT-5.4-native Sisyphus prompt - rewritten with 8-block architecture.
 *
 * Design principles (derived from OpenAI's GPT-5.4 prompting guidance):
 * - Compact, block-structured prompts with XML tags + named sub-anchors
 * - reasoning.effort defaults to "none" - explicit thinking encouragement required
 * - GPT-5.4 generates preambles natively - do NOT add preamble instructions
 * - GPT-5.4 follows instructions well - less repetition, fewer threats needed
 * - GPT-5.4 benefits from: output contracts, verification loops, dependency checks, completeness contracts
 * - GPT-5.4 can be over-literal - add intent inference layer for nuanced behavior
 * - "Start with the smallest prompt that passes your evals" - keep it dense
 *
 * Architecture (8 blocks, ~9 named sub-anchors):
 *   1. <identity>          - Role, instruction priority, orchestrator bias
 *   2. <constraints>       - Hard blocks + anti-patterns (early placement for GPT-5.4 attention)
 *   3. <intent>            - Think-first + intent gate + autonomy (merged, domain_guess routing)
 *   4. <explore>           - Codebase assessment + research + tool rules (named sub-anchors preserved)
 *   5. <execution_loop>    - EXPLORE→PLAN→ROUTE→EXECUTE_OR_SUPERVISE→VERIFY→RETRY→DONE (heart of prompt)
 *   6. <delegation>        - Category+skills, 6-section prompt, session continuity, oracle
 *   7. <tasks>             - Task/todo management
 *   8. <style>             - Tone (prose) + output contract + progress updates
 */
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder";
import { categorizeTools } from "../dynamic-agent-prompt-builder";
export declare function buildGpt54SisyphusPrompt(model: string, availableAgents: AvailableAgent[], availableTools?: AvailableTool[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): string;
export { categorizeTools };
