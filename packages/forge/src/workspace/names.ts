import { $ } from "bun"

export namespace Names {
  const ADJECTIVES = [
    "swift",
    "bright",
    "calm",
    "deft",
    "eager",
    "fair",
    "grand",
    "hale",
    "keen",
    "lush",
    "mild",
    "neat",
    "pale",
    "quick",
    "rare",
    "sage",
    "tall",
    "vast",
    "warm",
    "zesty",
    "bold",
    "cool",
    "dusk",
    "even",
    "free",
    "glad",
    "hazy",
    "icy",
    "just",
    "kind",
    "light",
    "mint",
    "neon",
    "opal",
    "pure",
    "rose",
    "soft",
    "teal",
    "ultra",
    "vivid",
    "wise",
    "agile",
    "brisk",
    "crisp",
    "dawn",
    "ember",
    "fresh",
    "gold",
    "idle",
    "lunar",
    "nova",
  ]

  const NOUNS = [
    "apex",
    "beam",
    "cove",
    "dawn",
    "echo",
    "fern",
    "glow",
    "haze",
    "isle",
    "jade",
    "kite",
    "lake",
    "mist",
    "node",
    "oak",
    "pine",
    "quay",
    "reef",
    "star",
    "tide",
    "vale",
    "wave",
    "arc",
    "bay",
    "cliff",
    "dune",
    "edge",
    "flux",
    "glen",
    "hill",
    "iris",
    "jet",
    "knot",
    "leaf",
    "moon",
    "nest",
    "oasis",
    "peak",
    "quill",
    "ridge",
    "shore",
    "trail",
    "umber",
    "void",
    "wind",
    "yarn",
    "zen",
    "brook",
    "crest",
    "delta",
  ]

  /**
   * Get the git username, falling back to system username or "user"
   */
  export async function getGitUsername(): Promise<string> {
    const result = await $`git config user.name`.quiet().nothrow()
    if (result.exitCode === 0) {
      const username = result.text().trim()
      if (username) {
        return sanitizeForBranch(username)
      }
    }

    // Try system username as fallback
    const whoami = await $`whoami`.quiet().nothrow()
    if (whoami.exitCode === 0) {
      const username = whoami.text().trim()
      if (username) {
        return sanitizeForBranch(username)
      }
    }

    return "user"
  }

  /**
   * Sanitize a string for use in a git branch name
   * - Converts to lowercase
   * - Replaces invalid characters with dashes
   * - Collapses multiple dashes
   * - Trims leading/trailing dashes
   */
  export function sanitizeForBranch(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
  }

  /**
   * Generate a random workspace name in the format: username/adjective-noun
   */
  export async function generateRandomName(): Promise<string> {
    const username = await getGitUsername()
    const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
    return `${username}/${adjective}-${noun}`
  }

  /**
   * Get a random adjective-noun pair (without username prefix)
   */
  export function generateRandomPair(): string {
    const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
    return `${adjective}-${noun}`
  }
}
