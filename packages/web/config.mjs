const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://pencode.ai" : `https://${stage}.pencode.ai`,
  console: stage === "production" ? "https://pencode.ai/auth" : `https://${stage}.pencode.ai/auth`,
  email: "help@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/kiyosh11/pencode",
  discord: "https://pencode.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
