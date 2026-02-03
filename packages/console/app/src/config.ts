/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://lotioncode.ai",

  // GitHub
  github: {
    repoUrl: "https://github.com/anomalyco/lotioncode",
    starsFormatted: {
      compact: "95K",
      full: "95,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/lotioncode",
    discord: "https://discord.gg/lotioncode",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "650",
    commits: "8,500",
    monthlyUsers: "2.5M",
  },
} as const
