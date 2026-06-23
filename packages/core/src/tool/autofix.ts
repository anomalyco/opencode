export * as AutofixTool from "./autofix"

import { ToolFailure, LLMClient, LLM } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { SessionStore } from "../session/store"
import { SessionRunnerModel } from "../session/runner/model"
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import { Location } from "../location"

export const name = "zero_auto_fix"

export const Input = Schema.Struct({
  command: Schema.String.annotate({ description: "The shell command to execute and self-heal if it fails" }),
  files: Schema.Array(Schema.String).annotate({ description: "Array of paths to the files that might need correction" }),
})

export const Output = Schema.Struct({
  success: Schema.Boolean,
  output: Schema.String,
  attempts: Schema.Number,
})

function runCommand(command: string, workdir: string) {
  return Effect.promise<{ exitCode: number | null; output: string }>(() => {
    return new Promise((resolve) => {
      const shell = process.env.SHELL || (process.platform === "win32" ? "cmd.exe" : "/bin/sh")
      const args = process.platform === "win32" ? ["/c", command] : ["-c", command]

      const proc = spawn(shell, args, {
        cwd: workdir,
        env: { ...process.env, LD_PRELOAD: "" }, // Prevents crash in Termux libc environment
        stdio: "pipe",
      })

      let output = ""
      proc.stdout.on("data", (data) => {
        output += data.toString()
      })
      proc.stderr.on("data", (data) => {
        output += data.toString()
      })

      proc.on("close", (code) => {
        resolve({ exitCode: code, output })
      })
      proc.on("error", (err) => {
        resolve({ exitCode: -1, output: `Process error: ${err.message}\n${output}` })
      })
    })
  })
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const store = yield* SessionStore.Service
    const models = yield* SessionRunnerModel.Service
    const permission = yield* PermissionV2.Service
    const llm = yield* LLMClient.Service
    const location = yield* Location.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description: "Execute a command. If it fails, autonomously analyze the errors and correct the specified files in a loop.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: `Auto-fix finished: success=${output.success}, attempts=${output.attempts}\nOutput:\n${output.output}`,
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              const workdir = location.directory
              const maxAttempts = 5
              let attempt = 0
              let lastOutput = ""
              let isSuccessful = false

              // Resolve model for fixing
              const session = yield* store.get(context.sessionID)
              if (!session) return yield* new ToolFailure({ message: "Session not found" })
              const model = yield* models.resolve(session)

              while (attempt < maxAttempts) {
                attempt++
                const result = yield* runCommand(input.command, workdir)
                lastOutput = result.output

                if (result.exitCode === 0) {
                  isSuccessful = true
                  break
                }

                // Command failed, read all watched files
                const fileContents: { path: string; content: string }[] = []
                for (const relativeOrAbsolute of input.files) {
                  const absolutePath = path.isAbsolute(relativeOrAbsolute)
                    ? relativeOrAbsolute
                    : path.join(workdir, relativeOrAbsolute)
                  const content = yield* Effect.promise(() => fs.readFile(absolutePath, "utf-8")).pipe(
                    Effect.catchAll(() => Effect.succeed("(file does not exist yet)")),
                  )
                  fileContents.push({ path: absolutePath, content })
                }

                // Call LLM to generate corrections
                const filesPrompt = fileContents
                  .map((f) => `File: ${f.path}\nContent:\n${f.content}\n---`)
                  .join("\n")

                const systemPrompt = `Você é o mecanismo de auto-correção autônoma do ZERO.
Sua tarefa é analisar o erro de execução de um comando e corrigir os arquivos fornecidos.
Retorne a correção de cada arquivo estruturada exatamente em blocos XML com o caminho absoluto do arquivo:
<file path="/caminho/absoluto/do/arquivo">
conteúdo completo e corrigido do arquivo
</file>

Importante: Retorne o arquivo COMPLETO corrigido, não apenas trechos ou diffs. Não inclua nenhuma outra explicação fora das tags <file>.`

                const userPrompt = `Comando executado: ${input.command}
Resultado da execução:
${lastOutput}

Arquivos sob monitoramento:
${filesPrompt}`

                const request = LLM.request({
                  model,
                  system: systemPrompt,
                  prompt: userPrompt,
                })

                const response = yield* llm.generate(request).pipe(
                  Effect.mapError((err) => new ToolFailure({ message: `Auto-fix LLM call failed: ${err.reason.message}` }))
                )

                // Extract text from response
                const textParts: string[] = []
                for (const event of response.events) {
                  if (event.type === "text-delta") {
                    textParts.push(event.text)
                  }
                }
                const llmOutput = textParts.join("")

                // Parse XML tags and write fixes
                const fileBlockRegex = /<file\s+path="([^"]+)">([\s\S]*?)<\/file>/g
                let match
                let filesWritten = 0

                while ((match = fileBlockRegex.exec(llmOutput)) !== null) {
                  const filePath = match[1]
                  const fileContent = match[2].trim()

                  yield* Effect.gen(function* () {
                    yield* Effect.promise(() => fs.mkdir(path.dirname(filePath), { recursive: true }))
                    yield* Effect.promise(() => fs.writeFile(filePath, fileContent, "utf-8"))
                    filesWritten++
                  }).pipe(Effect.catchAll(() => Effect.void))
                }

                if (filesWritten === 0) {
                  // No fixes parsed or LLM didn't return any tags, break to prevent infinite loops
                  break
                }
              }

              return {
                success: isSuccessful,
                output: lastOutput,
                attempts: attempt,
              }
            }).pipe(
              Effect.mapError((err) => (err instanceof ToolFailure ? err : new ToolFailure({ message: "Auto-fix execution failed" })))
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
