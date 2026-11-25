import { Plugin } from "@opencode/plugin"
import type { ArtifactFile, ArtifactPublishInput } from "@opencode/plugin/promise/artifact"
import { marked } from "marked"
import { createHash, createHmac } from "node:crypto"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

export default Plugin.define({
  id: "opencode.s3-artifacts",
  async setup(ctx) {
    if (ctx.options.bucket === undefined) return
    const config = readConfig(ctx.options)
    const send = signer(config, await readCredentials(ctx.options))

    const publish = async (input: ArtifactPublishInput, signal: AbortSignal, previous?: Receipt) => {
      const markdown = input.entry.endsWith(".md")
      const entry = markdown ? input.entry.slice(0, -3) + ".html" : input.entry
      if (markdown && input.assets[entry]) throw new Error(`${entry} already exists; publish it as the entry instead`)
      const files: Record<string, ArtifactFile> = markdown
        ? { ...input.assets, [entry]: render(input.title, input.assets[input.entry].bytes) }
        : { ...input.assets }
      const prefix = previous?.prefix ?? [config.prefix, input.id].filter(Boolean).join("/")
      await Promise.all(Object.entries(files).map(([file, item]) => send("PUT", `${prefix}/${file}`, signal, item)))
      await Promise.all(
        (previous?.keys ?? [])
          .filter((file) => !files[file])
          .map((file) => send("DELETE", `${prefix}/${file}`, signal)),
      )
      const page = config.spaRewrite && entry === "index.html" ? "" : entry
      return {
        url: [config.publicBaseUrl, ...`${prefix}/${page}`.split("/").map(encodeURIComponent)].join("/"),
        receipt: { prefix, keys: Object.keys(files) } satisfies Receipt,
      }
    }

    await ctx.experimental.artifact.transform((editor) => {
      editor.add({
        id: "s3",
        name: "S3",
        capabilities: config.spaRewrite ? ["static", "spa"] : ["static"],
        audiences: ["public"],
        defaultAudience: "public",
        prompt: [
          `Publishes static files to the S3 bucket ${config.bucket}, where anyone with the link can open them.`,
          "It serves files only: no server code, databases, storage or crons.",
          "Each artifact gets its own folder, so link assets with relative paths (./app.js; Vite base: './').",
          "A Markdown entry is also rendered to an HTML page beside it.",
          config.spaRewrite
            ? 'Single-page apps work: set "spa": true in artifact.json, and paths that match no file serve index.html.'
            : "Single-page apps aren't supported, since every path must be a real file; use hash routing.",
        ].join(" "),
        destination: async () => `s3:${new URL(config.endpoint).host}/${config.bucket}/${config.prefix}`,
        create: (input, context) => publish(input, context.signal),
        update: (_id, input, context) => publish(input, context.signal, input.receipt as Receipt | undefined),
        delete: async (_id, receipt, context) => {
          const previous = receipt as Receipt | undefined
          if (!previous) return
          await Promise.all(previous.keys.map((file) => send("DELETE", `${previous.prefix}/${file}`, context.signal)))
        },
      })
    })
  },
})

/** Where an artifact's files went: its key prefix and each file's path under it. */
interface Receipt {
  readonly prefix: string
  readonly keys: readonly string[]
}

function readConfig(options: Record<string, unknown>) {
  const text = (name: string) => {
    const value = options[name]
    if (value === undefined) return undefined
    if (typeof value !== "string") throw new Error(`s3-artifacts: ${name} must be a string`)
    return value.trim()
  }
  const bucket = text("bucket")
  const publicBaseUrl = text("publicBaseUrl")
  if (!bucket || !publicBaseUrl) throw new Error("s3-artifacts needs bucket and publicBaseUrl")
  const prefix = (text("prefix") ?? "").replace(/^\/+|\/+$/g, "")
  // Destinations become permission patterns, where these are wildcards.
  if (/[*?]/.test(prefix)) throw new Error("s3-artifacts: prefix can't contain * or ?")
  const region = text("region") || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1"
  return {
    bucket,
    prefix,
    region,
    endpoint: (text("endpoint") || `https://s3.${region}.amazonaws.com`).replace(/\/+$/, ""),
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ""),
    spaRewrite: options.spaRewrite === true,
  }
}

/** The plugin's own keys, then the AWS environment variables, then a profile in the shared credentials file. */
async function readCredentials(options: Record<string, unknown>) {
  if (typeof options.accessKeyId === "string" && typeof options.secretAccessKey === "string")
    return {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      sessionToken: typeof options.sessionToken === "string" ? options.sessionToken : undefined,
    }
  const env = process.env
  if (options.profile === undefined && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)
    return {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      sessionToken: env.AWS_SESSION_TOKEN,
    }
  const profile = typeof options.profile === "string" ? options.profile : (env.AWS_PROFILE ?? "default")
  const file = env.AWS_SHARED_CREDENTIALS_FILE ?? path.join(homedir(), ".aws", "credentials")
  const section = (await readFile(file, "utf8").catch(() => ""))
    .split(/^\s*\[/m)
    .find((part) => part.startsWith(`${profile}]`))
  const value = (name: string) => section?.match(new RegExp(`^\\s*${name}\\s*=\\s*(\\S+)`, "m"))?.[1]
  const accessKeyId = value("aws_access_key_id")
  const secretAccessKey = value("aws_secret_access_key")
  if (!accessKeyId || !secretAccessKey)
    throw new Error(
      `s3-artifacts found no credentials: set accessKeyId and secretAccessKey, AWS_ACCESS_KEY_ID, or profile ${profile} in ${file}`,
    )
  return { accessKeyId, secretAccessKey, sessionToken: value("aws_session_token") }
}

/** Sends a path-style S3 request signed with AWS Signature Version 4. */
function signer(config: ReturnType<typeof readConfig>, credentials: Awaited<ReturnType<typeof readCredentials>>) {
  const endpoint = new URL(config.endpoint)
  return async (method: "PUT" | "DELETE", key: string, signal: AbortSignal, file?: ArtifactFile) => {
    const pathname = "/" + [config.bucket, ...key.split("/")].map(encode).join("/")
    const time = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "")
    const scope = `${time.slice(0, 8)}/${config.region}/s3/aws4_request`
    const payload = createHash("sha256")
      .update(file?.bytes ?? "")
      .digest("hex")
    const headers: Record<string, string> = {
      "x-amz-content-sha256": payload,
      "x-amz-date": time,
      ...(file ? { "content-type": file.contentType } : {}),
      ...(credentials.sessionToken ? { "x-amz-security-token": credentials.sessionToken } : {}),
    }
    const signed = Object.entries({ ...headers, host: endpoint.host }).toSorted(([a], [b]) => a.localeCompare(b))
    const names = signed.map(([name]) => name).join(";")
    const request = [method, pathname, "", ...signed.map(([name, value]) => `${name}:${value}`), "", names, payload]
    const text = ["AWS4-HMAC-SHA256", time, scope, createHash("sha256").update(request.join("\n")).digest("hex")]
    const signingKey = [config.region, "s3", "aws4_request"].reduce(
      (secret, part) => createHmac("sha256", secret).update(part).digest(),
      createHmac("sha256", `AWS4${credentials.secretAccessKey}`).update(time.slice(0, 8)).digest(),
    )
    const signature = createHmac("sha256", signingKey).update(text.join("\n")).digest("hex")
    const response = await fetch(endpoint.origin + pathname, {
      method,
      headers: {
        ...headers,
        authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names}, Signature=${signature}`,
      },
      body: file?.bytes,
      signal,
    })
    if (!response.ok) throw new Error(`S3 ${method} ${key} failed with ${response.status}: ${await response.text()}`)
  }
}

/** Encodes a path segment the way SigV4 expects: RFC 3986, which leaves !'()* to encodeURIComponent. */
const encode = (segment: string) =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

function render(title: string, markdown: Uint8Array): ArtifactFile {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] ?? char)}</title>
<style>body{max-width:46rem;margin:2rem auto;padding:0 1rem;font:16px/1.6 system-ui,sans-serif}img{max-width:100%}pre{overflow:auto}</style>
</head>
<body>
${marked.parse(new TextDecoder().decode(markdown), { async: false })}
</body>
</html>
`
  return { bytes: new TextEncoder().encode(html), contentType: "text/html; charset=utf-8" }
}
