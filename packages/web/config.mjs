const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://cyberstrike.io" : `https://${stage}.cyberstrike.io`,
  console: stage === "production" ? "https://cyberstrike.io/auth" : `https://${stage}.cyberstrike.io/auth`,
  email: "contact@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/CyberStrikeus/cyberstrike",
  discord: "https://cyberstrike.io/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
