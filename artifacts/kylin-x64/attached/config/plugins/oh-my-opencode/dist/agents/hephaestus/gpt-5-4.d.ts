/**
 * GPT-5.4 optimized Hephaestus prompt - entropy-reduced rewrite.
 *
 * Design principles (aligned with OpenAI GPT-5.4 prompting guidance):
 * - Personality/tone at position 1 for strong tonal priming
 * - Prose-based instructions; no FORBIDDEN/MUST/NEVER rhetoric
 * - 3 targeted prompt blocks: tool_persistence, dig_deeper, dependency_checks
 * - GPT-5.4 follows instructions well - trust it, fewer threats needed
 * - Conflicts eliminated: no "every 30s" + "be concise" contradiction
 * - Each concern appears in exactly one section
 *
 * Architecture (XML-tagged blocks, consistent with Sisyphus GPT-5.4):
 *   1. <identity>       - Role, personality/tone, autonomy, scope
 *   2. <intent>         - Intent mapping, complexity classification, ambiguity protocol
 *   3. <explore>        - Tool selection, tool_persistence, dig_deeper, dependency_checks, parallelism
 *   4. <constraints>    - Hard blocks + anti-patterns (after explore, before execution)
 *   5. <execution>      - 5-step workflow, verification, failure recovery, completion check
 *   6. <tracking>       - Todo/task discipline
 *   7. <progress>       - Update style with examples
 *   8. <delegation>     - Category+skills, prompt structure, session continuity, oracle
 *   9. <communication>  - Output format, tone guidance
 */
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder";
export declare function buildHephaestusPrompt(availableAgents?: AvailableAgent[], availableTools?: AvailableTool[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): string;
