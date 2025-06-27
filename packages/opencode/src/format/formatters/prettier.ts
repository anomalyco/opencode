import { App } from "../../app/app"
import { BunProc } from "../../bun"
import type {Definition} from '../definition'

const prettier: Definition = {
       name: "prettier",
       command: [BunProc.which(), "run", "prettier", "--write", "$FILE"],
       environment: {
         BUN_BE_BUN: "1",
       },
       extensions: [
         ".js",
         ".jsx",
         ".mjs",
         ".cjs",
         ".ts",
         ".tsx",
         ".mts",
         ".cts",
         ".html",
         ".htm",
         ".css",
         ".scss",
         ".sass",
         ".less",
         ".vue",
         ".svelte",
         ".json",
         ".jsonc",
         ".yaml",
         ".yml",
         ".toml",
         ".xml",
         ".md",
         ".mdx",
         ".graphql",
         ".gql",
       ],
       async enabled() {
         try {
           const proc = Bun.spawn({
             cmd: [BunProc.which(), "run", "prettier", "--version"],
             cwd: App.info().path.cwd,
             env: {
               BUN_BE_BUN: "1",
             },
             stdout: "ignore",
             stderr: "ignore",
           })
           const exit = await proc.exited
           return exit === 0
         } catch {
           return false
         }
       },
}

export default prettier
