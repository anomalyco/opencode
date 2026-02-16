import type { Argv } from "yargs"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { APICallError } from "ai"
import { ProviderError } from "../../provider/error"
import { generateText } from "ai"

export const RollCallCommand = cmd({
  command: "roll-call [filter]",
  describe: "batch-test all models for connectivity and latency",
  builder: (yargs: Argv) => {
    return yargs
      .positional("filter", {
        type: "string",
        describe: "regex to filter models by provider/modelID",
      })
      .option("prompt", {
        type: "string",
        default: "Hello",
        describe: "Prompt to send to each model",
      })
      .option("timeout", {
        type: "number",
        default: 25000,
        describe: "Timeout for each model call in milliseconds",
      })
      .option("parallel", {
        type: "number",
        default: 5,
        describe: "Number of parallel model calls",
      })
      .option("retries", {
        type: "number",
        default: 0,
        describe: "Number of additional retries for each model call",
      })
      .option("verbose", {
        type: "boolean",
        default: false,
        describe: "Show verbose output",
      })
      .option("quiet", {
        type: "boolean",
        default: false,
        describe: "Suppress non-error output",
      })
      .option("output", {
        type: "string",
        choices: ["table", "json"],
        default: "table",
        describe: "Output format",
      })
  },
  handler: async (args) => {
    await rollCallHandler(args)
  },
})

interface RollCallResult {
  model: string
  access: boolean
  snippet: string
  latency: number | null
  errorType: string | null
  errorMessage: string | null
}

export async function rollCallHandler(args: any) {
  const { prompt, timeout, filter, parallel, output, verbose, quiet } = args

  if (!quiet) {
    UI.println(`${UI.Style.TEXT_INFO}Starting roll call for models with prompt: "${prompt}"${UI.Style.TEXT_NORMAL}`)
    UI.println(`${UI.Style.TEXT_INFO}Timeout per model: ${timeout}ms, Parallel calls: ${parallel}${UI.Style.TEXT_NORMAL}`)
  }

  await Instance.provide({
    directory: process.cwd(),
    async fn() {
      const providers = await Provider.list()
      const modelsToTest: { providerID: string; modelID: string; model: Provider.Model }[] = []

      for (const [providerID, provider] of Object.entries(providers)) {
        for (const [modelID, model] of Object.entries(provider.models)) {
          const fullName = `${providerID}/${modelID}`
          if (filter) {
            try {
              const regex = new RegExp(filter, "i")
              if (!regex.test(fullName)) continue
            } catch (e) {
              UI.error(`Invalid filter regex: ${filter}`)
              return
            }
          }
          modelsToTest.push({ providerID, modelID, model })
        }
      }

      if (modelsToTest.length === 0) {
        if (!quiet) UI.println(`${UI.Style.TEXT_WARNING}No models to test after filtering.${UI.Style.TEXT_NORMAL}`)
        return
      }

      if (!quiet) {
        UI.println(`${UI.Style.TEXT_INFO}Testing ${modelsToTest.length} models...${UI.Style.TEXT_NORMAL}`)
      }

      const results: RollCallResult[] = []
      const queue = [...modelsToTest]
      const activePromises: Promise<void>[] = []

      const processModel = async (item: (typeof modelsToTest)[0]) => {
        const { providerID, modelID, model } = item
        const fullName = `${providerID}/${modelID}`
        const startTime = Date.now()
        let access = false
        let snippet = ""
        let latency: number | null = null
        let errorType: string | null = null
        let errorMessage: string | null = null

        try {
          const languageModel = await Provider.getLanguage(model)
          const { text } = await generateText({
            model: languageModel,
            prompt,
            abortSignal: AbortSignal.timeout(timeout),
          })
          access = true
          snippet = text.substring(0, 50).replace(/\n/g, " ")
          latency = Date.now() - startTime
        } catch (e: any) {
          latency = Date.now() - startTime
          if (e instanceof APICallError) {
            const parsedError = ProviderError.parseAPICallError({
              providerID,
              error: e,
            })
            errorType = parsedError.type
            errorMessage = parsedError.message
          } else {
            errorType = "unknown"
            errorMessage = e.message || "An unknown error occurred"
          }
        }

        results.push({
          model: fullName,
          access,
          snippet,
          latency,
          errorType,
          errorMessage,
        })

        if (verbose && !quiet) {
          if (access) {
            UI.println(`${UI.Style.TEXT_SUCCESS}✔${UI.Style.TEXT_NORMAL} ${fullName} - ${latency}ms`)
          } else {
            UI.println(`${UI.Style.TEXT_DANGER}✘${UI.Style.TEXT_NORMAL} ${fullName} - ${errorType}: ${errorMessage}`)
          }
        }
      }

      while (queue.length > 0 || activePromises.length > 0) {
        while (queue.length > 0 && activePromises.length < parallel) {
          const item = queue.shift()!
          const promise = processModel(item).finally(() => {
            const index = activePromises.indexOf(promise)
            if (index > -1) {
              activePromises.splice(index, 1)
            }
          })
          activePromises.push(promise)
        }
        if (activePromises.length > 0) {
          await Promise.race(activePromises)
        }
      }

      if (quiet) return

      if (output === "json") {
        console.log(JSON.stringify(results, null, 2))
      } else {
        const headers = ["Model", "Access", "Snippet", "Latency"]

        const truncate = (text: string, maxLen: number) => {
          if (maxLen < 10) return text.substring(0, maxLen - 3) + "..."
          return text.length > maxLen ? text.substring(0, maxLen - 3) + "..." : text
        }

        const rows = results.map((r) => [
          r.model,
          r.access ? "YES" : "NO",
          r.access ? r.snippet : r.errorMessage ? `(${r.errorMessage})` : "",
          r.latency !== null ? `${r.latency}ms` : "N/A",
        ])

        const widths = headers.map((h, i) =>
          Math.max(h.length, ...rows.map((r) => r[i].length))
        )

        const totalWidth = widths.reduce((a, b) => a + b, 0) + 9
        const terminalWidth = process.stdout.columns || 120

        if (totalWidth > terminalWidth && widths[2] > 20) {
          widths[2] = Math.max(20, widths[2] - (totalWidth - terminalWidth))
        }

        const headerRow = headers
          .map((h, i) => h.padEnd(widths[i]))
          .join(" | ")
        UI.println(headerRow)
        UI.println("-".repeat(headerRow.length))

        rows.forEach((row, idx) => {
          const result = results[idx]
          const color = result.access ? UI.Style.TEXT_SUCCESS : UI.Style.TEXT_DANGER
          const truncatedRow = [
            row[0],
            row[1],
            row[2] ? truncate(row[2], widths[2]) : row[2],
            row[3],
          ]
          const line = truncatedRow.map((c, i) => c.padEnd(widths[i])).join(" | ")
          UI.println(color + line + UI.Style.TEXT_NORMAL)
        })

        const successful = results.filter((r) => r.access).length
        const failed = results.length - successful
        UI.println("")
        UI.println(`${UI.Style.TEXT_SUCCESS}${successful} accessible${UI.Style.TEXT_NORMAL}, ${UI.Style.TEXT_DANGER}${failed} failed${UI.Style.TEXT_NORMAL}`)
      }
    },
  })
}
