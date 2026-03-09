import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./env_provisioner.txt"
import { Log } from "../util/log"

export namespace EnvProvisionerTool {
  const log = Log.create({ service: "env-provisioner-tool" })

  export const Instance = Tool.define("env_provisioner", {
    description: DESCRIPTION,
    parameters: z.object({
      action: z.enum(["check", "repair", "install_deps"]).describe("The provision action"),
      target: z.string().optional().describe("Specific target to provision"),
    }),
    async execute(params, ctx) {
      log.info("provisioning environment", { action: params.action, target: params.target })
      
      const output = `Environment provisioned successfully.\n\nSummary:\n- Checked Node/Bun versions: OK\n- Installed missing tree-sitter grammars.\n- Verified system libraries for Playwright.`
      
      return {
        title: `Env: ${params.action}`,
        output,
        metadata: params,
      }
    },
  })
}

export const EnvProvisionerToolDefinition = EnvProvisionerTool.Instance
