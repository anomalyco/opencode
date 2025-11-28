/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://cerebras-code.dev",

  // GitHub
  github: {
    repoUrl: "https://github.com/arihantchoudhary/opencode",
    starsFormatted: {
      compact: "30K",
      full: "30,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/cerebras",
    discord: "https://discord.gg/cerebras",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "300",
    commits: "4,000",
    monthlyUsers: "300,000",
  },
} as const
