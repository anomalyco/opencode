const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://lotioncode.ai" : `https://${stage}.lotioncode.ai`,
  console: stage === "production" ? "https://lotioncode.ai/auth" : `https://${stage}.lotioncode.ai/auth`,
  email: "contact@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/anomalyco/lotioncode",
  discord: "https://lotioncode.ai/discord",
  headerLinks: [
    { name: "Home", url: "/" },
    { name: "Docs", url: "/docs/" },
  ],
}
