/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://opencode.ai",

  // GitHub
  github: {
    repoUrl: "https://github.com/anomalyco/opencode",
    starsFormatted: {
      compact: "60K",
      full: "60,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/opencode",
    discord: "https://discord.gg/opencode",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "500",
    commits: "6,500",
    monthlyUsers: "650,000",
  },
} as const
