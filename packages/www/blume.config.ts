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
  theme: {
    background: "#131010",
    fonts: {
      body: "ibm-plex-mono",
      display: "ibm-plex-mono",
      mono: "ibm-plex-mono",
    },
    mode: "dark",
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
  seo: {
    og: {
      fonts: [{ name: "IBM Plex Mono", weight: [400, 600] }],
      logo: "public/assets/logo-dark.svg",
      palette: {
        accent: "#b7b1b1",
        background: "#131010",
        border: "#343030",
        foreground: "#f1ecec",
        muted: "#b7b1b1",
      },
    },
  },
  deployment: {
    adapter: "cloudflare",
    base: "/v2/",
    output: "server",
    site: process.env.BLUME_ENV === "dev" ? "https://dev.opencode.ai" : "https://opencode.ai",
  },
})
