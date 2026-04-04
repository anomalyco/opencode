/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://f5xc-salesdemos.github.io/xcsh",

  // GitHub
  github: {
    repoUrl: "https://github.com/f5xc-salesdemos/xcsh",
    starsFormatted: {
      compact: "120K",
      full: "120,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/xcsh",
    discord: "https://discord.gg/xcsh",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "800",
    commits: "10,000",
    monthlyUsers: "5M",
  },
} as const
