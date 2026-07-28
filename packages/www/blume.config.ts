import { defineConfig } from "blume"

export default defineConfig({
  title: "OpenCode",
  description: "The open source AI coding agent.",
  basePath: "/docs",
  logo: {
    image: {
      light: "/assets/logo-light.svg",
      dark: "/assets/logo-dark.svg",
      alt: "OpenCode",
    },
    text: "",
    href: "/",
  },
  content: {
    root: "content/docs",
  },
  github: {
    owner: "anomalyco",
    repo: "opencode",
    branch: "dev",
    dir: "packages/www",
  },
  navigation: {
    tabs: [
      { label: "Docs", path: "/" },
      { label: "Build", path: "/build" },
      { label: "API", path: "/api" },
    ],
  },
  openapi: {
    enabled: true,
    route: "/api",
    spec: "./openapi.json",
  },
  deployment: {
    adapter: "cloudflare",
    base: "/v2/",
    output: "server",
    site: process.env.BLUME_ENV === "dev" ? "https://dev.opencode.ai" : "https://opencode.ai",
  },
})
