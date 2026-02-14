const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://weapon.ai" : `https://${stage}.weapon.ai`,
  console: stage === "production" ? "https://weapon.ai/auth" : `https://${stage}.weapon.ai/auth`,
  email: "contact@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/anomalyco/weapon",
  discord: "https://weapon.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
