import type { Ontology } from "./ontology.ts"
import type { ProposedChange, PropertyValue } from "./types.ts"

/** Context handed to an action when it proposes a change. */
export interface ActionContext {
  ontology: Ontology
  query: string
  /** The object the action is targeting, if any. */
  subjectId?: string
}

/**
 * A kinetic-layer action. Actions are *governed*: `propose` returns a
 * `ProposedChange` (a write-back proposal) and never mutates state directly —
 * application happens only after review/merge in the governance layer.
 */
export interface ActionType<P = Record<string, unknown>> {
  name: string
  /** ObjectType this action operates on (or "*" for global). */
  targetType: string
  /** Permission key checked by the governance layer. */
  permission: string
  description: string
  /** Return an error string if params are invalid, else undefined. */
  validate?(params: P): string | undefined
  propose(ctx: ActionContext, params: P): ProposedChange | Promise<ProposedChange>
}

export class ActionRegistry {
  private readonly actions = new Map<string, ActionType<any>>()

  register<P>(action: ActionType<P>): this {
    this.actions.set(action.name, action as ActionType<any>)
    return this
  }

  get(name: string): ActionType<any> | undefined {
    return this.actions.get(name)
  }

  list(): ActionType<any>[] {
    return [...this.actions.values()]
  }

  /** Actions applicable to a given object type (plus globals). */
  forType(typeName: string): ActionType<any>[] {
    return this.list().filter((a) => a.targetType === typeName || a.targetType === "*")
  }
}

// ---- Built-in actions ------------------------------------------------------

/** Reply to the user without changing any object. */
export const answerAction: ActionType<{ text: string }> = {
  name: "answer",
  targetType: "*",
  permission: "aip.answer",
  description: "Answer the user's query directly without modifying any object.",
  validate: (p) => (p.text?.trim() ? undefined : "answer text is required"),
  propose: (_ctx, params) => ({ kind: "answer", summary: "answer the query", answer: params.text }),
}

/** Set a scalar property on an object (e.g. update a description). */
export const setPropertyAction: ActionType<{ id: string; property: string; value: PropertyValue }> = {
  name: "set-property",
  targetType: "*",
  permission: "aip.object.update",
  description: "Set a property value on an existing object.",
  validate: (p) => (p.id && p.property ? undefined : "id and property are required"),
  propose: (ctx, params) => {
    const obj = ctx.ontology.get(params.id)
    if (!obj) return { kind: "noop", summary: `object ${params.id} not found` }
    return {
      kind: "update-property",
      targetId: params.id,
      property: params.property,
      value: params.value,
      before: String(obj.properties[params.property] ?? ""),
      after: String(params.value ?? ""),
      summary: `set ${params.property} on ${params.id}`,
    }
  },
}

/** Propose a new body for a Skill — the write-back goes to disk via the merge step. */
export const updateSkillAction: ActionType<{ skillId: string; newBody: string; rationale?: string }> = {
  name: "update-skill",
  targetType: "Skill",
  permission: "aip.skill.update",
  description: "Propose a rewritten body for a skill (deployed via the normal PR + test gate).",
  validate: (p) => (p.skillId && p.newBody?.trim() ? undefined : "skillId and newBody are required"),
  propose: (ctx, params) => {
    const skill = ctx.ontology.get(params.skillId)
    if (!skill || skill.type !== "Skill") {
      return { kind: "noop", summary: `skill ${params.skillId} not found` }
    }
    return {
      kind: "update-skill",
      targetId: params.skillId,
      skillPath: String(skill.properties.path ?? ""),
      newBody: params.newBody,
      summary: `update skill "${skill.properties.name ?? params.skillId}"`,
    }
  },
}

/** A registry preloaded with the built-in actions. */
export function defaultActions(): ActionRegistry {
  return new ActionRegistry().register(answerAction).register(setPropertyAction).register(updateSkillAction)
}
