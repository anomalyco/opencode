const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://crazycode.ai" : `https://${stage}.crazycode.ai`,
  console: stage === "production" ? "https://crazycode.ai/auth" : `https://${stage}.crazycode.ai/auth`,
  email: "contact@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/anomalyco/crazycode",
  discord: "https://crazycode.ai/discord",
  headerLinks: [
    { name: "Home", url: "/" },
    { name: "Docs", url: "/docs/" },
  ],
}
