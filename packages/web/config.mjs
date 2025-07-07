const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production"
    ? "https://opencode.ai"
    : `https://${stage}.opencode.ai`,
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/sst/opencode",
  discord: "https://discord.gg/opencode",
  headerLinks: [
    { name: "Home", url: "/" },
    { name: "Docs", url: "/docs/" },
  ],
}
