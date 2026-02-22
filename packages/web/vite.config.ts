import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"
import { cloudflare } from "@cloudflare/vite-plugin"

export default defineConfig(({ mode }) => ({
  plugins: [
    solidPlugin(),
    cloudflare({
      config: {
        compatibility_date: "2026-01-14",
        //   dev: {
        //     ENVIRONMENT: "",
        //     VITE_API_URL: "http://localhost:9000",
        //     WEB_DOMAIN: "http://localhost:8787",
        //     VITE_ORIGIN_CORS: "http://localhost:8787",
        //   },
      },
      auxiliaryWorkers: [
        {
          config: {
            r2_buckets: [
              {
                binding: "SESSIONS_STORE",
                bucket_name: "opencode-sessions",
                preview_bucket_name: "opencode-development",
              },
            ],
          },
          configPath: "../cloudsession/wrangler.jsonc",
          viteEnvironment: {
            name: "worker",
          },
        },
      ],
    }),
  ],

  server: {
    proxy: {
      worker: {
        target: "http://localhost:4321",
        ws: true,
      },
    },
  },

  environments: {
    client: {
      root: ".",
      build: {
        outDir: "dist/assets",
      },
    },
    worker: {
      build: {
        rollupOptions: {
          input: "./src/worker.ts",
          output: {
            entryFileNames: "[name]/index.js",
          },
        },
      },
    },
  },
}))
