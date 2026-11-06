const stage = process.env.SST_STAGE || "dev"
const url = stage === "production" ? "https://opencode.ai" : `https://${stage}.opencode.ai`

export default {
  url,
  console: stage === "production" ? "https://opencode.ai/auth" : `https://${stage}.opencode.ai/auth`,
  email: "help@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/anomalyco/opencode",
  discord: "https://opencode.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    // The V2 docs on the main site; this app is the V1 docs, on docs.opencode.ai.
    { name: "app.header.docs", url: `${url}/docs` },
  ],
}
