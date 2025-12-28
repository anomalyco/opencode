/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://opencode.ai",

  // GitHub
  github: {
    repoUrl: "https://github.com/sst/opencode",
    starsFormatted: {
      compact: "38K",
      full: "38,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/opencode",
    discord: "https://discord.gg/opencode",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "400",
    commits: "5,000",
    monthlyUsers: "400,000",
  },
} as const
