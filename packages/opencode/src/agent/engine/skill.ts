export interface Skill {
  skill_id: string
  trigger_condition: string
  prompt_template: string
  priority: number
  scope: "global" | "session" | "task"
  hit_count: number
  created_at: number
}

export const HookPoints = {
  SESSION_INIT: "session:init",
  PROMPT_BEFORE_BUILD: "prompt:before-build",
  TOOL_AFTER_CALL: "tool:after-call",
  SESSION_END: "session:end",
} as const

export type HookPoint = (typeof HookPoints)[keyof typeof HookPoints]

export class SkillSystem {
  private skills = new Map<string, Skill>()
  private hookHandlers = new Map<HookPoint, Array<(context: Record<string, unknown>) => Promise<void>>>()

  registerSkill(skill: Skill): void {
    this.skills.set(skill.skill_id, skill)
  }

  unregisterSkill(skillId: string): void {
    this.skills.delete(skillId)
  }

  matchSkills(context: string): Skill[] {
    return Array.from(this.skills.values())
      .filter((s) => {
        try {
          return context.toLowerCase().includes(s.trigger_condition.toLowerCase())
        } catch {
          return false
        }
      })
      .sort((a, b) => b.priority - a.priority)
  }

  onHook(hookPoint: HookPoint, handler: (context: Record<string, unknown>) => Promise<void>): void {
    const handlers = this.hookHandlers.get(hookPoint) ?? []
    handlers.push(handler)
    this.hookHandlers.set(hookPoint, handlers)
  }

  async triggerHook(hookPoint: HookPoint, context: Record<string, unknown>): Promise<void> {
    const handlers = this.hookHandlers.get(hookPoint) ?? []
    for (const handler of handlers) {
      try {
        await handler(context)
      } catch {
        // Hook failures must not propagate
      }
    }
  }

  buildPromptInjection(currentGoal: string): string {
    const skills = this.matchSkills(currentGoal)
    if (skills.length === 0) return ""

    return skills.map((s) => `[Skill: ${s.skill_id}] ${s.prompt_template}`).join("\n")
  }

  getAllSkills(): Skill[] {
    return Array.from(this.skills.values()).sort((a, b) => b.priority - a.priority)
  }

  recordHit(skillId: string): void {
    const skill = this.skills.get(skillId)
    if (skill) {
      skill.hit_count++
    }
  }
}

export const DAG_GENERATION_PROMPT = `
You are a task planner. Given the user goal and available capabilities, generate a DAG.

Goal: {{goal}}

Available capabilities:
{{capabilities}}

Rules:
1. Every node must reference a capability_id from the list above
2. Dependencies must form a DAG (no cycles)
3. Include estimated tokens and duration for each node
4. Mark risk_level per node (0=read-only, 1=local-modify, 2=global-impact, 3=destructive)
5. Only include nodes that directly contribute to the goal

Output JSON format:
{
  "nodes": [
    {
      "node_id": "n1",
      "capability_id": "...",
      "inputs": {},
      "dependencies": [],
      "risk_level": 0,
      "estimated_tokens": 100,
      "estimated_duration_ms": 5000
    }
  ],
  "edges": [["n1", "n2"]]
}
`

export * as Skill from "./skill"
