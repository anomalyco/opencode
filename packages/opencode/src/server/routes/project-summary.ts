import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { generateObject } from "ai"
import z from "zod"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { SessionID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { Provider } from "../../provider/provider"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const ProjectSummaryShape = z.object({
  title: z.string(),
  description: z.string(),
  usage: z.string(),
})

const ProjectSummary = ProjectSummaryShape.meta({ ref: "ProjectSummary" })

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".cache",
  ".vite",
  ".vscode",
  ".idea",
  "coverage",
])
const IGNORE_FILES = new Set(["bun.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", ".DS_Store"])
const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".webm",
  ".wav",
  ".zip",
  ".tar",
  ".gz",
  ".pdf",
])

const MAX_FILES = 500
const MAX_DEPTH = 8
const PER_FILE_CAP = 8 * 1024
const TOTAL_BODY_BUDGET = 64 * 1024

const ENTRY_HINTS: RegExp[] = [
  /(^|\/)README(\.|$)/i,
  /(^|\/)package\.json$/,
  /(^|\/)pyproject\.toml$/,
  /(^|\/)Cargo\.toml$/,
  /(^|\/)go\.mod$/,
  /(^|\/)index\.html$/,
  /(^|\/)src\/main\.[jt]sx?$/,
  /(^|\/)src\/App\.[jt]sx?$/,
  /(^|\/)src\/index\.[jt]sx?$/,
  /(^|\/)app\/page\.[jt]sx?$/,
]

const PATH_REGEX = /[\w./-]+\.(?:tsx?|jsx?|html|css|scss|md|json|py|go|rs|java|kt|rb|swift|vue|svelte|toml|yaml|yml)\b/g

async function collectFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string, depth: number) {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith(".")) continue
        await walk(path.join(dir, e.name), depth + 1)
      } else if (e.isFile()) {
        if (IGNORE_FILES.has(e.name)) continue
        const ext = path.extname(e.name).toLowerCase()
        if (BINARY_EXT.has(ext)) continue
        out.push(path.relative(root, path.join(dir, e.name)))
      }
    }
  }
  await walk(root, 0)
  return out
}

function extractMentionedPaths(transcript: string): Set<string> {
  return new Set(transcript.match(PATH_REGEX) ?? [])
}

function rankFiles(files: string[], mentioned: Set<string>): string[] {
  const score = (f: string) => {
    let s = 0
    for (const re of ENTRY_HINTS) if (re.test(f)) s += 1000
    for (const m of mentioned) {
      if (f === m || f.endsWith("/" + m) || m.endsWith("/" + f)) s += 500
    }
    return s
  }
  return [...files].sort((a, b) => score(b) - score(a))
}

async function buildWorkspaceContext(root: string, transcript: string): Promise<string> {
  const files = await collectFiles(root)
  if (files.length === 0) return ""
  const mentioned = extractMentionedPaths(transcript)
  const ranked = rankFiles(files, mentioned)
  const tree = [...files].sort().join("\n")

  let used = 0
  const bodies: string[] = []
  for (const rel of ranked) {
    if (used >= TOTAL_BODY_BUDGET) break
    const abs = path.join(root, rel)
    let raw: string
    try {
      raw = await readFile(abs, "utf8")
    } catch {
      continue
    }
    const text = raw.length > PER_FILE_CAP ? raw.slice(0, PER_FILE_CAP) + "\n... (truncated)" : raw
    const block = `=== ${rel} ===\n${text}\n`
    const remain = TOTAL_BODY_BUDGET - used
    if (block.length > remain) {
      if (remain > 200) bodies.push(block.slice(0, remain) + "\n... (truncated)")
      break
    }
    bodies.push(block)
    used += block.length
  }

  return ["워크스페이스 트리:", tree, "", "핵심 파일:", bodies.join("\n")].join("\n")
}

export const ProjectSummaryRoutes = lazy(() =>
  new Hono().post(
    "/generate",
    describeRoute({
      summary: "Generate project summary",
      description:
        "Summarize the given session into a public-gallery project summary (title, description, usage). Runs in the background and is not appended to the session message stream.",
      operationId: "projectSummary.generate",
      responses: {
        200: {
          description: "Generated summary",
          content: {
            "application/json": {
              schema: resolver(ProjectSummary),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "json",
      z.object({
        sessionID: SessionID.zod,
        providerID: ProviderID.zod.optional(),
        modelID: ModelID.zod.optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json")
      const session = await Session.get(body.sessionID)
      const msgs = await Session.messages({ sessionID: body.sessionID })

      let providerID = body.providerID
      let modelID = body.modelID
      if (!providerID || !modelID) {
        for (let i = msgs.length - 1; i >= 0; i--) {
          const info = msgs[i].info
          if (info.role === "user") {
            providerID = info.model.providerID
            modelID = info.model.modelID
            break
          }
        }
      }
      if (!providerID || !modelID) {
        const def = await Provider.defaultModel()
        providerID = def.providerID
        modelID = def.modelID
      }

      const info = await Provider.getModel(providerID, modelID)
      const language = await Provider.getLanguage(info)

      const transcript = msgs
        .map((m) => {
          const text = m.parts
            .filter((p): p is MessageV2.TextPart => p.type === "text")
            .map((p) => p.text)
            .join("\n")
          return text.trim().length > 0 ? `[${m.info.role}] ${text}` : ""
        })
        .filter((line) => line.length > 0)
        .join("\n\n")

      const workspaceContext = await buildWorkspaceContext(session.directory, transcript)

      if (transcript.trim().length === 0 && workspaceContext.length === 0) {
        return c.json({ title: "", description: "", usage: "" })
      }

      const { object } = await generateObject({
        model: language,
        abortSignal: c.req.raw.signal,
        schema: ProjectSummaryShape,
        system: [
          "당신은 공유 갤러리에 올라갈 '서비스 소개글' 을 작성합니다.",
          "독자는 코드를 읽지 않는 일반 사용자입니다. 결과물(앱/서비스) 자체를 소개하세요.",
          "절대 금지: 기술 스택, 라이브러리·프레임워크 이름, 구현 방식, 파일/함수/API 이름, 코드 용어, 디버깅 과정, '구현했습니다/추가했습니다' 같은 개발자 시점 표현.",
          "transcript 의 언어와 같은 언어로 답변하세요.",
        ].join(" "),
        prompt: `다음 작업 기록과 워크스페이스 상태를 바탕으로, 이 결과물을 '서비스 소개' 형태로 정리하세요. 워크스페이스 트리와 핵심 파일이 실제 만들어진 결과물의 권위 있는 근거이며, 작업 기록은 보조 단서입니다. 둘 사이가 충돌하면 워크스페이스를 우선합니다.

각 필드 가이드:
- title: 서비스의 이름 또는 한 줄 정체성. 60자 이내. 예) "증권 리서치 자동화 도구".
- description: 이 서비스가 사용자에게 무엇을 해주는지 한두 문장으로. 기술이 아니라 '가치/효용'. 예) "뉴스와 리서치 데이터를 자동으로 수집하여 종목별 분석 리포트를 만들어주는 도구입니다."
- usage: 사용자가 이 서비스를 쓰는 단계를 한 줄에 한 단계씩, 번호 없이 줄바꿈으로 구분. 각 단계는 명령형 문장. 예)
  "종목코드를 입력합니다
  기간을 선택합니다
  분석 시작 버튼을 클릭합니다"

작업 기록:
${transcript || "(empty)"}

${workspaceContext || "(워크스페이스 비어있음)"}`,
      })

      return c.json(object)
    },
  ),
)
