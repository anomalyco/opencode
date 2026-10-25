import fs from "node:fs"
import path from "node:path"
import { Effect, Schema, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { Global } from "@bolt-ai/core/global"
import DESCRIPTION from "./browser.txt"
import * as Tool from "./tool"

const TIMEOUT = 30_000

// PATH names first, then well-known absolute locations (macOS app bundles).
export const CANDIDATES = [
  "chromium",
  "chromium-browser",
  "google-chrome",
  "google-chrome-stable",
  "chrome",
  "brave-browser",
  "msedge",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
]

/** Pick the first resolved browser binary from candidate lookups. */
export function binary(candidates: (string | null | undefined)[]): string | undefined {
  return candidates.find((candidate): candidate is string => !!candidate)
}

/**
 * Validate and normalize a target URL. Only http and https are allowed; a
 * scheme-less value like `localhost:3000/x` is treated as http. Returns
 * undefined for anything else (file://, chrome://, malformed input).
 */
export function normalize(url: string): string | undefined {
  const trimmed = url.trim()
  if (!trimmed) return undefined
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : trimmed.includes(":") && !/^[^/]+:\d/.test(trimmed)
      ? undefined
      : `http://${trimmed}`
  if (!candidate) return undefined
  const parsed = (() => {
    try {
      return new URL(candidate)
    } catch {
      return undefined
    }
  })()
  if (!parsed) return undefined
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined
  return parsed.href
}

/** Build headless Chromium args for a one-shot capture. */
export function args(
  action: "screenshot" | "text",
  url: string,
  opts: { out?: string; width: number; height: number; sandbox: boolean },
): string[] {
  return [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--disable-extensions",
    // Root (e.g. containers) cannot use the Chromium sandbox.
    ...(opts.sandbox ? [] : ["--no-sandbox"]),
    `--window-size=${opts.width},${opts.height}`,
    // Give SPAs a few seconds of virtual time to render before capture.
    "--virtual-time-budget=5000",
    `--timeout=${TIMEOUT}`,
    ...(action === "screenshot" ? [`--screenshot=${opts.out}`] : ["--dump-dom"]),
    url,
  ]
}

/** Crude visible-text extraction from rendered HTML. */
export function strip(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
}

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({
    description: "The URL to open, e.g. http://localhost:3000/settings. Only http and https are allowed.",
  }),
  action: Schema.optional(Schema.Literals(["screenshot", "text"])).annotate({
    description: "screenshot writes a PNG and returns its path (default); text returns the page's visible text",
  }),
  width: Schema.optional(Schema.Number).annotate({ description: "Viewport width in pixels (default 1280)" }),
  height: Schema.optional(Schema.Number).annotate({ description: "Viewport height in pixels (default 800)" }),
})

export const BrowserTool = Tool.define(
  "browser",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const url = normalize(params.url)
          if (!url) throw new Error(`invalid url: ${params.url} (only http and https URLs are supported)`)
          yield* ctx.ask({
            permission: "browser",
            patterns: [url],
            always: ["*"],
            metadata: { url, action: params.action ?? "screenshot" },
          })

          const found = binary(CANDIDATES.map((candidate) => Bun.which(candidate) ?? undefined))
          if (!found) {
            throw new Error(
              `No Chromium-based browser found (looked for ${CANDIDATES.filter((c) => !c.startsWith("/")).join(", ")}). Install one, e.g. \`apt-get install chromium\` or \`brew install --cask google-chrome\`.`,
            )
          }

          const action = params.action ?? "screenshot"
          const out =
            action === "screenshot" ? path.join(Global.Path.tmp, `browser-${Date.now().toString(36)}.png`) : undefined
          if (out) fs.mkdirSync(path.dirname(out), { recursive: true })
          const argv = args(action, url, {
            out,
            width: params.width ?? 1280,
            height: params.height ?? 800,
            sandbox: process.getuid ? process.getuid() !== 0 : true,
          })

          let raw = ""
          const code = yield* Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* spawner.spawn(ChildProcess.make(found, argv, { stdin: "ignore" }))
              yield* Effect.forkScoped(
                Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                  Effect.sync(() => {
                    raw += chunk
                  }),
                ),
              )
              const exit = yield* Effect.raceAll([
                handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
                Effect.sleep(`${TIMEOUT} millis`).pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
              ])
              if (exit.kind === "timeout") {
                yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.catch(() => Effect.void))
              }
              return exit.code
            }),
          ).pipe(Effect.orDie)

          if (action === "screenshot") {
            if (!out || !fs.existsSync(out)) {
              throw new Error(
                `browser did not produce a screenshot (exit ${code ?? "timeout"}): ${raw.trim().slice(0, 500) || "no output"}`,
              )
            }
            return {
              title: `${url} [screenshot]`,
              output: [`Screenshot of ${url}:`, "", out, "", "Use the read tool on this path to view the page."].join(
                "\n",
              ),
              metadata: { url, action: params.action ?? "screenshot", browser: found, exit: code },
            }
          }

          if (code !== 0) {
            throw new Error(`browser exited with ${code ?? "timeout"}: ${raw.trim().slice(0, 500) || "no output"}`)
          }
          const text = strip(raw)
          return {
            title: `${url} [text]`,
            output: text || "(page rendered no visible text)",
            metadata: { url, action: params.action ?? "screenshot", browser: found, exit: code },
          }
        }),
    }
  }),
)
