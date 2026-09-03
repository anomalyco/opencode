import config from "./playwright.config"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4795)
export default {
  ...config,
  testMatch: "timeline/location-catalog-benchmark.spec.ts",
  webServer: {
    command: `bun x vite preview --outDir "${process.env.CATALOGS_DIST}" --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
}
