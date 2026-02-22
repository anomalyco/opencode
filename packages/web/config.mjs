const url = process.env.SITE_URL || "https://opencode.j9xym.com"

export default {
  url,
  console: `${url}/auth`,
  email: process.env.SITE_EMAIL || "electrictaoist@gmail.com",
  socialCard: process.env.SOCIAL_CARD_URL || "https://social-cards.j9xym.com",
  github: process.env.SITE_GITHUB || "https://github.com/manno23/opencode",
  // discord: "https://opencode.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
