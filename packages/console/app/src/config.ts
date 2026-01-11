/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://crazycode.ai",

  // GitHub
  github: {
    repoUrl: "https://github.com/anomalyco/crazycode",
    starsFormatted: {
      compact: "50K",
      full: "50,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/crazycode",
    discord: "https://discord.gg/crazycode",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "500",
    commits: "6,500",
    monthlyUsers: "650,000",
  },
} as const
