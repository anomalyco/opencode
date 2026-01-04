export type SkillDefinition = {
  name: string
  description: string
  content: string
}

/**
 * Helper for defining a skill with type safety.
 * @example
 * skill({
 *   name: "my-skill",
 *   description: "Does something useful",
 *   content: `# My Skill\n\nInstructions here...`
 * })
 */
export function skill(input: SkillDefinition): SkillDefinition {
  return input
}
