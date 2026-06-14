const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://daemonprotocol.com" : `https://${stage}.daemonprotocol.com`,
  console: stage === "production" ? "https://daemonprotocol.com/auth" : `https://${stage}.daemonprotocol.com/auth`,
  email: "help@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/daemon-blockint-tech/daemoncode",
  discord: "https://daemonprotocol.com/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
