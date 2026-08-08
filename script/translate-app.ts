#!/usr/bin/env bun

import path from "path"
import { parseArgs } from "util"
import { pathToFileURL } from "url"

const locales = [
  "ar",
  "br",
  "bs",
  "da",
  "de",
  "es",
  "fr",
  "ja",
  "ko",
  "no",
  "pl",
  "ru",
  "uk",
  "th",
  "tr",
  "zh",
  "zht",
] as const
type Locale = (typeof locales)[number]

const languages = {
  ar: "Arabic",
  br: "Brazilian Portuguese",
  bs: "Bosnian",
  da: "Danish",
  de: "German",
  es: "Spanish",
  fr: "French",
  ja: "Japanese",
  ko: "Korean",
  no: "Norwegian Bokmal",
  pl: "Polish",
  ru: "Russian",
  uk: "Ukrainian",
  th: "Thai",
  tr: "Turkish",
  zh: "Simplified Chinese",
  zht: "Traditional Chinese",
} as const satisfies Record<Locale, string>

type Dictionary = Record<string, string>
type Drift = ReturnType<typeof findDrift>
type Domain = { name: string; source: string; target: string; drift: Drift }

const desktopLocales = new Set<Locale>(locales.filter((locale) => locale !== "th" && locale !== "tr"))
const root = path.resolve(import.meta.dir, "..")

export function parseTranslationArgs(args: string[]) {
  const parsed = parseArgs({
    args,
    options: {
      concurrency: { type: "string", short: "c", default: "4" },
      model: { type: "string", default: "opencode/gpt-5.5" },
      variant: { type: "string", default: "xhigh" },
      "dry-run": { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  })
  const target = parsed.positionals[0] ?? "all"
  const concurrency = Number(parsed.values.concurrency)

  if (!parsed.values.help && parsed.positionals.length !== 1) throw new Error("Pass one locale or 'all'.")
  if (target !== "all" && !isLocale(target)) throw new Error(`Unknown locale '${target}'.`)
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Concurrency must be a positive integer.")

  return {
    target,
    concurrency: target === "all" ? concurrency : 1,
    model: parsed.values.model,
    variant: parsed.values.variant,
    dryRun: parsed.values["dry-run"],
    check: parsed.values.check,
    help: parsed.values.help,
  }
}

export function targetFiles(locale: Locale) {
  return [
    `packages/app/src/i18n/${locale}.ts`,
    `packages/ui/src/i18n/${locale}.ts`,
    ...(desktopLocales.has(locale) ? [`packages/desktop/src/renderer/i18n/${locale}.ts`] : []),
  ]
}

export function glossaryFile(locale: Locale) {
  if (locale === "zh") return ".opencode/glossary/zh-cn.md"
  if (locale === "zht") return ".opencode/glossary/zh-tw.md"
  return `.opencode/glossary/${locale}.md`
}

export function findDrift(source: Dictionary, target: Dictionary) {
  return {
    missing: Object.keys(source).filter((key) => !Object.hasOwn(target, key)),
    extra: Object.keys(target).filter((key) => !Object.hasOwn(source, key)),
    placeholders: Object.keys(source).filter(
      (key) => Object.hasOwn(target, key) && tokens(source[key]).join() !== tokens(target[key]).join(),
    ),
  }
}

export function sessionIDFromEvents(output: string) {
  const match = output.match(/"sessionID"\s*:\s*"([^"]+)"/)
  if (!match?.[1]) throw new Error("OpenCode did not report a session ID.")
  return match[1]
}

export function sessionModels(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.messages))
    throw new Error("OpenCode returned an invalid session export.")
  return value.messages.flatMap((message) => {
    if (!isRecord(message) || !isRecord(message.info) || message.info.role !== "assistant") return []
    if (typeof message.info.providerID !== "string" || typeof message.info.modelID !== "string") {
      throw new Error("OpenCode session export omitted the assistant model.")
    }
    return [
      {
        model: `${message.info.providerID}/${message.info.modelID}`,
        variant: typeof message.info.variant === "string" ? message.info.variant : undefined,
      },
    ]
  })
}

export function modelVariants(output: string, model: string) {
  const normalized = output.replaceAll("\r\n", "\n")
  const marker = `${model}\n`
  const start = normalized.indexOf(marker)
  if (start < 0) throw new Error(`Model not found: ${model}`)
  const provider = model.split("/")[0]
  const rest = normalized.slice(start + marker.length)
  const next = rest.search(new RegExp(`^${escapeRegExp(provider)}/`, "m"))
  const metadata: unknown = JSON.parse((next < 0 ? rest : rest.slice(0, next)).trim())
  if (!isRecord(metadata) || !isRecord(metadata.variants)) throw new Error(`Model variants not found: ${model}`)
  return metadata.variants
}

export function translationConfig(agent: string, model: string, targets: string[]) {
  return {
    $schema: "https://opencode.ai/config.json",
    model,
    default_agent: agent,
    share: "disabled" as const,
    formatter: false,
    lsp: false,
    snapshot: false,
    agent: {
      [agent]: {
        mode: "primary" as const,
        model,
        permission: {
          "*": "deny" as const,
          read: "allow" as const,
          glob: "allow" as const,
          grep: "allow" as const,
          edit: Object.fromEntries([["*", "deny"], ...targets.map((target) => [target, "allow"])]),
        },
      },
    },
  }
}

export function unexpectedChanges(before: Record<string, string>, after: Record<string, string>, allowed: string[]) {
  const targets = new Set(allowed)
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((file) => !targets.has(file) && before[file] !== after[file])
    .sort()
}

export async function runPool<T, R>(items: readonly T[], concurrency: number, task: (item: T) => Promise<R>) {
  const results = new Map<number, R>()
  const entries = items.entries()
  const worker = async (): Promise<void> => {
    const next = entries.next()
    if (next.done) return
    results.set(next.value[0], await task(next.value[1]))
    await worker()
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return Array.from(results.entries())
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1])
}

async function main() {
  const options = parseTranslationArgs(Bun.argv.slice(2))
  if (options.help) {
    console.log(`
Usage: bun run translate:app -- <locale|all> [options]

Synchronizes product app translations with the English app, UI, and desktop dictionaries.

Options:
  -c, --concurrency <count>  Maximum parallel OpenCode runs for 'all' (default: 4)
      --model <provider/id>  OpenCode model (default: opencode/gpt-5.5)
      --variant <name>       Model variant (default: xhigh)
      --dry-run              Report drift without running OpenCode
      --check                Exit nonzero when translation drift exists
  -h, --help                 Show this help message

Examples:
  bun run translate:app -- fr
  bun run translate:app -- all --concurrency 4
`)
    return
  }

  const selected = options.target === "all" ? locales : [options.target]
  const plans = await Promise.all(selected.map((locale) => inspect(locale)))
  plans.forEach(report)
  const pending = plans.filter((plan) => plan.domains.some((domain) => changed(domain.drift)))
  if (options.check) {
    if (pending.length) process.exitCode = 1
    return
  }
  if (options.dryRun || pending.length === 0) return

  const targets = pending.flatMap((plan) => plan.domains.map((domain) => domain.target))
  const baseline = await worktreeSnapshot()
  const variant = await resolveModelVariant(options.model, options.variant)
  console.log(`Resolved ${options.model} (${options.variant}): ${JSON.stringify(variant)}`)
  const template = await commandTemplate()
  const results = await runPool(pending, options.concurrency, (plan) =>
    translate(plan, template, options.model, options.variant).catch((error) => ({
      locale: plan.locale,
      code: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    })),
  )

  results.forEach((result) => {
    if (result.stdout) process.stdout.write(`\n[${result.locale}]\n${result.stdout}`)
    if (result.stderr) process.stderr.write(`\n[${result.locale}]\n${result.stderr}`)
  })

  const failed = results.filter((result) => result.code !== 0)
  const checks = await runPool(pending, options.concurrency, (plan) => check(plan.locale))
  const incomplete = checks.filter((result) => result.code !== 0)
  const escaped = unexpectedChanges(baseline, await worktreeSnapshot(), targets)
  incomplete.forEach((result) => {
    if (result.stdout) process.stderr.write(`\n[${result.locale} verification]\n${result.stdout}`)
    if (result.stderr) process.stderr.write(`\n[${result.locale} verification]\n${result.stderr}`)
  })

  if (failed.length === 0 && incomplete.length === 0 && escaped.length === 0) {
    console.log(`\nTranslated ${pending.map((plan) => plan.locale).join(", ")}.`)
    return
  }

  if (failed.length) console.error(`\nOpenCode failed for: ${failed.map((result) => result.locale).join(", ")}`)
  if (incomplete.length)
    console.error(`Translation remains incomplete for: ${incomplete.map((plan) => plan.locale).join(", ")}`)
  if (escaped.length) console.error(`Translation changed files outside its locale targets: ${escaped.join(", ")}`)
  process.exitCode = 1
}

async function worktreeSnapshot() {
  const groups = await Promise.all([
    gitPaths(["diff", "--name-only", "-z", "HEAD"]),
    gitPaths(["ls-files", "--others", "--exclude-standard", "-z"]),
  ])
  const files = [...new Set(groups.flat())]
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => {
        const target = Bun.file(path.join(root, file))
        if (!(await target.exists())) return [file, "<missing>"] as const
        const hash = new Bun.CryptoHasher("sha256")
        hash.update(await target.arrayBuffer())
        return [file, hash.digest("hex")] as const
      }),
    ),
  )
}

async function gitPaths(args: string[]) {
  const proc = Bun.spawn(["git", ...args], {
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const result = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (result[2] !== 0) throw new Error(result[1] || `git ${args.join(" ")} failed`)
  return result[0].split("\0").filter(Boolean)
}

async function check(locale: Locale) {
  const proc = Bun.spawn([process.execPath, import.meta.path, locale, "--check"], {
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const result = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { locale, stdout: result[0], stderr: result[1], code: result[2] }
}

async function inspect(locale: Locale) {
  const domains = await Promise.all(
    targetFiles(locale).map(async (target) => {
      const source = target.replace(`/${locale}.ts`, "/en.ts")
      const dictionaries = await Promise.all([dictionary(source), dictionary(target)])
      return {
        name: target.includes("packages/app/") ? "app" : target.includes("packages/ui/") ? "ui" : "desktop",
        source,
        target,
        drift: findDrift(dictionaries[0], dictionaries[1]),
      }
    }),
  )
  return { locale, language: languages[locale], domains }
}

async function dictionary(file: string) {
  const module: unknown = await import(pathToFileURL(path.join(root, file)).href)
  if (typeof module !== "object" || module === null || !("dict" in module) || !isDictionary(module.dict)) {
    throw new Error(`Invalid translation dictionary: ${file}`)
  }
  return module.dict
}

async function commandTemplate() {
  return (await Bun.file(path.join(root, "script/translate-app.md")).text()).trim()
}

async function translate(
  plan: { locale: Locale; language: string; domains: Domain[] },
  template: string,
  model: string,
  variant: string,
) {
  const glossary = glossaryFile(plan.locale)
  const glossaryContent = (await Bun.file(path.join(root, glossary)).exists())
    ? await Bun.file(path.join(root, glossary)).text()
    : undefined
  const prompt = template.replaceAll("$1", plan.locale).replaceAll(
    "$ARGUMENTS",
    JSON.stringify(
      {
        locale: plan.locale,
        language: plan.language,
        glossary: glossaryContent ? { file: glossary, content: glossaryContent } : undefined,
        domains: plan.domains.map((domain) => ({
          source: domain.source,
          target: domain.target,
          ...domain.drift,
        })),
      },
      null,
      2,
    ),
  )
  const agent = `translate-app-${plan.locale}-${process.pid}`
  const env = isolatedEnvironment()
  env.OPENCODE_DISABLE_PROJECT_CONFIG = "1"
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify(
    translationConfig(
      agent,
      model,
      plan.domains.map((domain) => domain.target),
    ),
  )

  const proc = Bun.spawn(
    [
      "opencode",
      "--pure",
      "run",
      "--dir",
      root,
      "--agent",
      agent,
      "--model",
      model,
      "--variant",
      variant,
      "--title",
      `Translate app ${plan.locale}`,
      "--format",
      "json",
    ],
    {
      cwd: root,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const stdout = new Response(proc.stdout).text()
  const stderr = new Response(proc.stderr).text()
  await proc.stdin.write(prompt)
  await proc.stdin.end()
  const result = await Promise.all([stdout, stderr, proc.exited])
  if (result[2] !== 0) return { locale: plan.locale, stdout: result[0], stderr: result[1], code: result[2] }

  const sessionID = sessionIDFromEvents(result[0])
  const exported = Bun.spawn(["opencode", "--pure", "export", sessionID, "--sanitize"], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const exportResult = await Promise.all([
    new Response(exported.stdout).text(),
    new Response(exported.stderr).text(),
    exported.exited,
  ])
  if (exportResult[2] !== 0) {
    return { locale: plan.locale, stdout: textFromEvents(result[0]), stderr: exportResult[1], code: exportResult[2] }
  }

  const session: unknown = JSON.parse(exportResult[0])
  const observed = sessionModels(session)
  const mismatch = observed.length === 0 || observed.some((item) => item.model !== model || item.variant !== variant)
  const actual = Array.from(new Set(observed.map((item) => `${item.model} (${item.variant ?? "default"})`))).join(", ")
  return {
    locale: plan.locale,
    stdout: `${textFromEvents(result[0])}\nVerified session model: ${actual}\n`,
    stderr: mismatch
      ? `Requested ${model} (${variant}), but session used ${actual || "no assistant model"}.\n`
      : result[1],
    code: mismatch ? 1 : 0,
  }
}

function report(plan: { locale: Locale; domains: Domain[] }) {
  const details = plan.domains
    .map(
      (domain) =>
        `${domain.name}: ${domain.drift.missing.length} missing, ${domain.drift.extra.length} extra, ${domain.drift.placeholders.length} placeholder mismatches`,
    )
    .join("; ")
  console.log(`[${plan.locale}] ${details}`)
}

function changed(drift: Drift) {
  return drift.missing.length > 0 || drift.extra.length > 0 || drift.placeholders.length > 0
}

function isLocale(value: string): value is Locale {
  return Object.hasOwn(languages, value)
}

function isDictionary(value: unknown): value is Dictionary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  return Object.values(value).every((item) => typeof item === "string")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function resolveModelVariant(model: string, variant: string) {
  const provider = model.split("/")[0]
  if (!provider || !model.includes("/")) throw new Error(`Model must use provider/model syntax: ${model}`)
  const env = isolatedEnvironment()
  env.OPENCODE_DISABLE_PROJECT_CONFIG = "1"
  const proc = Bun.spawn(["opencode", "--pure", "models", provider, "--verbose"], {
    cwd: root,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const result = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (result[2] !== 0) throw new Error(result[1] || `Unable to resolve model: ${model}`)
  const variants = modelVariants(result[0], model)
  if (!Object.hasOwn(variants, variant)) throw new Error(`Variant '${variant}' is not configured for ${model}.`)
  return variants[variant]
}

function isolatedEnvironment() {
  const env = { ...process.env }
  delete env.OPENCODE_CONFIG
  delete env.OPENCODE_CONFIG_DIR
  delete env.OPENCODE_CONFIG_CONTENT
  delete env.OPENCODE_PERMISSION
  delete env.OPENCODE_AUTO_SHARE
  return env
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function textFromEvents(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .flatMap((line) => {
      const event: unknown = JSON.parse(line)
      if (!isRecord(event) || event.type !== "text" || !isRecord(event.part) || typeof event.part.text !== "string") {
        return []
      }
      return [event.part.text.trim()]
    })
    .filter(Boolean)
    .join("\n")
}

function tokens(value: string) {
  return Array.from(value.matchAll(/{{\s*([^}]+?)\s*}}/g), (match) => match[1] ?? "").sort()
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
