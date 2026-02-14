/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://cyberstrike.io",

  // GitHub
  github: {
    repoUrl: "https://github.com/CyberStrikeus/cyberstrike",
    starsFormatted: {
      compact: "100K",
      full: "100,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/cyberstrike",
    discord: "https://discord.gg/cyberstrike",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "700",
    commits: "9,000",
    monthlyUsers: "2.5M",
  },
} as const
