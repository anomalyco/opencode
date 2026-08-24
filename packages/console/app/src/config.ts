/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://pencode.ai",

  // GitHub
  github: {
    repoUrl: "https://github.com/kiyosh11/pencode",
    starsFormatted: {
      compact: "195K",
      full: "195,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/pencode",
    discord: "https://discord.gg/pencode",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "950",
    commits: "13,000",
    monthlyUsers: "16M",
  },
} as const
