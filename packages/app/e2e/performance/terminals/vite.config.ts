import { mergeConfig } from "vite"
import config from "../../../vite.config"

// The probe is included only in this manual benchmark build, never in the app build.
export default mergeConfig(config, {
  plugins: [
    {
      name: "terminal-benchmark-probe",
      transformIndexHtml: {
        order: "pre",
        handler: () => [
          { tag: "script", attrs: { type: "module", src: "/e2e/performance/terminals/probe.ts" }, injectTo: "head" },
        ],
      },
    },
  ],
})
