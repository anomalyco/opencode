# Task 5: Silent Skill & Governance Injection

**Files:**

- Modify: `src/session/prompt.ts`
- Create: `src/knowledge/skill-mapper.ts`

**Goal:** Auto-inject relevant skills and united-governance context when knowledge_search results are returned.

---

## Step 1: Create Skill Mapper

Create `src/knowledge/skill-mapper.ts`:

```typescript
import { Skill } from "../skill"
import { Log } from "../util/log"

const log = Log.create({ service: "knowledge.skill-mapper" })

export namespace SkillMapper {
  // Map tags to relevant skills
  const TAG_TO_SKILLS: Record<string, string[]> = {
    // Recovery & debugging
    recovery: ["systematic-debugging"],
    retry: ["systematic-debugging"],
    fallback: ["systematic-debugging"],
    workaround: ["systematic-debugging"],

    // Architecture & design
    architecture: ["opencode-dev-ops", "writing-plans"],
    "design-pattern": ["opencode-dev-ops"],
    refactor: ["opencode-dev-ops"],
    modular: ["opencode-dev-ops"],

    // Testing & quality
    testing: ["test-driven-development"],
    coverage: ["test-driven-development"],
    "unit-test": ["test-driven-development"],
    "integration-test": ["test-driven-development"],

    // Performance
    performance: ["requesting-code-review"],
    optimization: ["requesting-code-review"],

    // Security
    security: ["requesting-code-review"],
    auth: ["opencode-dev-ops"],

    // Deployment
    deployment: ["finishing-a-development-branch"],
    release: ["finishing-a-development-branch"],
    "breaking-change": ["requesting-code-review"],

    // Documentation
    documentation: ["writing-skills"],
    process: ["brainstorming"],
  }

  export async function getSkillsForTags(tags: string[]): Promise<Skill.Info[]> {
    const skillNames = new Set<string>()

    for (const tag of tags) {
      const skills = TAG_TO_SKILLS[tag.toLowerCase()] || []
      skills.forEach((s) => skillNames.add(s))
    }

    const result: Skill.Info[] = []

    for (const name of skillNames) {
      try {
        const skill = await Skill.get(name)
        if (skill) {
          result.push(skill)
        }
      } catch (err) {
        log.warn("skill not found", { name })
      }
    }

    return result
  }

  export function formatSkillsForPrompt(skills: Skill.Info[]): string {
    if (skills.length === 0) return ""

    const lines: string[] = [
      "## Auto-Injected Skills",
      "",
      "Based on the knowledge search results, these skills may be relevant to your task:",
      "",
    ]

    for (const skill of skills) {
      lines.push(`### ${skill.name}`)
      lines.push("")
      lines.push(skill.content.split("\n").slice(0, 5).join("\n"))
      lines.push("")
      lines.push("[Full skill available via skill tool]")
      lines.push("")
    }

    return lines.join("\n")
  }
}
```

---

## Step 2: Modify Session Prompt for Injection

Modify `src/session/prompt.ts`:

Find the function that builds the system prompt for the agent. Typically this is `buildSystemPrompt()` or similar.

Add this import at the top:

```typescript
import { SkillMapper } from "../knowledge/skill-mapper"
import { Knowledge } from "../knowledge"
```

Then find where tool results are processed. Add logic after a `knowledge_search` tool executes:

```typescript
// In the tool execution section, after knowledge_search result is received:
if (toolCall.name === "knowledge_search") {
  const results = toolCall.output // The markdown output
  const metadata = toolCall.metadata // Contains result tags

  // Extract tags from results
  const tags = extractTagsFromResults(results)

  // Get relevant skills
  const skills = await SkillMapper.getSkillsForTags(tags)

  // Format skills for injection
  const skillsContext = SkillMapper.formatSkillsForPrompt(skills)

  // Load united-governance
  const govSkill = await Skill.get("united-governance")
  const govContext = govSkill
    ? `## Governance Context\n\n${govSkill.content.split("\n").slice(0, 10).join("\n")}\n\n[Full governance available via skill tool]`
    : ""

  // Inject into system context (transparent to agent)
  // This happens AFTER the knowledge_search results are returned to the agent
  // The agent sees the search results, and these are available in the context

  log.info("injected skills and governance", { skillCount: skills.length })
}
```

Add helper function to extract tags from markdown results:

```typescript
function extractTagsFromResults(markdown: string): string[] {
  const tags = new Set<string>()

  // Extract tags from backtick format: `tag`
  const tagMatches = markdown.match(/`([a-z0-9\-]+)`/gi) || []
  for (const match of tagMatches) {
    const tag = match.slice(1, -1).toLowerCase()
    tags.add(tag)
  }

  // Extract from **Tags:** lines
  const lineMatches = markdown.match(/\*\*Tags:\*\*\s*([^\n]+)/gi) || []
  for (const line of lineMatches) {
    const tagStr = line.replace(/\*\*Tags:\*\*/i, "").trim()
    const parts = tagStr.split(/,\s*/)
    for (const part of parts) {
      const cleaned = part.replace(/`/g, "").trim().toLowerCase()
      if (cleaned) tags.add(cleaned)
    }
  }

  return Array.from(tags)
}
```

---

## Step 3: Verify Silent Injection

The injection should be:

- **Transparent** - Agent doesn't explicitly request it
- **Automatic** - Happens whenever knowledge_search is called
- **Non-intrusive** - Doesn't interrupt the agent's response

The skills and governance are available in the context but not forced into the agent's output. The agent can reference them if needed.

---

## Step 4: Test Skill Injection

Create `src/knowledge/skill-mapper.test.ts`:

```typescript
import { describe, it, expect } from "bun:test"
import { SkillMapper } from "./skill-mapper"

describe("SkillMapper", () => {
  it("maps tags to skills", async () => {
    const tags = ["recovery", "architecture", "testing"]
    const skills = await SkillMapper.getSkillsForTags(tags)

    // Should find at least some skills
    expect(skills.length).toBeGreaterThan(0)

    // Should include expected skills
    const skillNames = skills.map((s) => s.name)
    expect(skillNames).toContain("systematic-debugging") // recovery
    expect(skillNames).toContain("opencode-dev-ops") // architecture
    expect(skillNames).toContain("test-driven-development") // testing
  })

  it("formats skills for prompt", async () => {
    const tags = ["architecture"]
    const skills = await SkillMapper.getSkillsForTags(tags)
    const formatted = SkillMapper.formatSkillsForPrompt(skills)

    expect(formatted).toContain("Auto-Injected Skills")
    expect(formatted).toContain("relevant to your task")
  })

  it("handles unknown tags gracefully", async () => {
    const tags = ["unknown_tag_xyz", "recovery"]
    const skills = await SkillMapper.getSkillsForTags(tags)

    // Should still return skills for known tags
    expect(skills.length).toBeGreaterThan(0)
  })
})
```

Run tests:

```bash
cd packages/opencode
bun test src/knowledge/skill-mapper.test.ts
```

---

## Step 5: Document Injection Behavior

Add comment to session/prompt.ts explaining the injection:

```typescript
/**
 * Silent Skill & Governance Injection
 *
 * When knowledge_search tool is executed:
 * 1. Extract semantic tags from results
 * 2. Map tags to relevant skills (e.g., "recovery" -> systematic-debugging)
 * 3. Load skill content and inject into context
 * 4. Load united-governance and inject into context
 *
 * This is TRANSPARENT to the agent:
 * - Agent sees knowledge_search results
 * - Skills and governance are available in context
 * - Agent can reference them if helpful
 * - No explicit requests needed
 *
 * This enables agents to automatically discover and apply relevant
 * development practices based on the knowledge they retrieve.
 */
```

---

## Step 6: Verify No Console Writes

Search for any `console.log`, `console.error`, `console.warn` in the modified files:

```bash
grep -r "console\." src/knowledge/ src/session/prompt.ts
```

Expected: No matches. All logging via `Log.create()`.

---

## Step 7: Commit

```bash
git add src/knowledge/skill-mapper.ts
git add src/session/prompt.ts
git add src/knowledge/skill-mapper.test.ts
git commit -m "feat: add silent skill and governance injection with knowledge search"
```

---

## Acceptance Criteria

✅ Tags extracted from knowledge_search markdown results  
✅ Tags mapped to relevant skills  
✅ Skills loaded and formatted for injection  
✅ united-governance automatically loaded  
✅ Injection is transparent (no explicit agent action needed)  
✅ Graceful handling of unknown tags  
✅ All tests passing  
✅ No console writes  
✅ Proper logging via Log.create()
