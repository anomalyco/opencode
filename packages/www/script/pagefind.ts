import config from "../astro.config"

const base = config.base?.replace(/\/$/, "") ?? ""

await Bun.$`pagefind --site ${`dist/client${base}/docs`}`
