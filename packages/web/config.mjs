const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://f5xc-salesdemos.github.io/xcsh" : `https://${stage}.f5xc-salesdemos.github.io/xcsh`,
  console: stage === "production" ? "https://f5xc-salesdemos.github.io/xcsh/auth" : `https://${stage}.f5xc-salesdemos.github.io/xcsh/auth`,
  email: "contact@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/f5xc-salesdemos/xcsh",
  discord: "https://f5xc-salesdemos.github.io/xcsh/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
