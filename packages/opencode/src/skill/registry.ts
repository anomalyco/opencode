const skillPaths: string[] = []

export namespace SkillRegistry {
  export function register(skillPath: string) {
    skillPaths.push(skillPath)
  }

  export function paths(): readonly string[] {
    return skillPaths
  }

  export function clear() {
    skillPaths.length = 0
  }
}
