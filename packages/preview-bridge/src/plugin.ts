// 미리보기 브릿지 자가치유 플러그인 (opencode).
//
// 동작: 응답이 끝날 때(session.idle)마다 결과물 프로젝트 디렉토리에
//   1) /__preview-bridge.js (브릿지 번들) 가 최신인지 확인해 없거나 다르면 복사하고,
//   2) 엔트리 HTML(index.html 등) 의 <body> 끝에 브릿지 <script> 태그를 멱등하게 주입한다.
// AI 가 AGENTS.md 지침대로 이미 넣었으면 그대로 두고, 빠뜨린 경우에만 보강한다(= AI 의도 작업 보조).
//
// HTML 주입은 정규식이 아닌 node-html-parser 로 파싱해서 처리한다(견고).
// 멱등성: 내용이 바뀌지 않으면 절대 다시 쓰지 않는다(파일 watcher 리로드 루프 방지).
//
// 빌드: packages/preview-bridge 에서 `bun run build:plugin` → docker/preview-bridge-plugin.js
//   (node-html-parser 를 포함한 단일 node ESM 번들 → 컨테이너 런타임 의존성 해결 불필요).

import { readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "node-html-parser"

// 자식 dev 서버 루트에서 브릿지가 서빙될 경로 / 멱등 마커.
const BRIDGE_SCRIPT_PATH = "/__preview-bridge.js"
const BRIDGE_FILENAME = "__preview-bridge.js"
const BRIDGE_MARKER = "data-preview-bridge"
const SCRIPT_TAG = `<script src="${BRIDGE_SCRIPT_PATH}" ${BRIDGE_MARKER}></script>`

// 주입 대상 후보(엔트리 HTML). 프로젝트 루트 + 프레임워크 정적 디렉토리.
// dist/ 는 빌드 산출물이라 제외(재빌드 시 덮어써지고, 빌드 결과물은 건드리지 않는다).
const HTML_CANDIDATES = ["index.html", "public/index.html", "src/index.html"]
// 브릿지 번들 사본을 둘 위치(여러 서버 형태 대응). 존재하는 디렉토리에만 기록.
const BRIDGE_TARGET_DIRS = [".", "public", "static"]

const SOURCE_BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "preview-bridge.js")

const log = (...args: unknown[]) => console.error("[preview-bridge-plugin]", ...args)

/** 내용이 같으면 쓰지 않는다(리로드 루프 방지). 변경 시 true. */
async function writeIfChanged(path: string, content: string): Promise<boolean> {
  try {
    if (existsSync(path) && (await readFile(path, "utf8")) === content) return false
  } catch {
    /* 읽기 실패 시 그냥 덮어쓴다 */
  }
  await writeFile(path, content)
  return true
}

/** <body> 끝(없으면 root)에 스크립트 태그 1회 주입. 이미 마커가 있으면 원본 그대로 반환. */
function injectTag(html: string): string {
  const root = parse(html, { comment: true })
  if (root.querySelector(`script[${BRIDGE_MARKER}]`)) return html
  const body = root.querySelector("body") ?? root
  body.insertAdjacentHTML("beforeend", SCRIPT_TAG)
  return root.toString()
}

export default async function previewBridgePlugin({ directory }: { directory?: string }) {
  let bridgeSource = ""
  try {
    bridgeSource = await readFile(SOURCE_BRIDGE, "utf8")
  } catch (err: any) {
    log("브릿지 번들을 찾지 못했습니다. 주입을 건너뜁니다:", SOURCE_BRIDGE, err?.message)
  }

  async function heal() {
    if (!bridgeSource || !directory) return
    // 1) 브릿지 번들 사본 배치 — 존재하는 후보 디렉토리에.
    for (const dir of BRIDGE_TARGET_DIRS) {
      const targetDir = dir === "." ? directory : join(directory, dir)
      if (!existsSync(targetDir)) continue
      try {
        await writeIfChanged(join(targetDir, BRIDGE_FILENAME), bridgeSource)
      } catch (err: any) {
        log("브릿지 복사 실패:", targetDir, err?.message)
      }
    }
    // 2) 엔트리 HTML 에 스크립트 태그 주입.
    for (const rel of HTML_CANDIDATES) {
      const path = join(directory, rel)
      if (!existsSync(path)) continue
      try {
        const html = await readFile(path, "utf8")
        const next = injectTag(html)
        if (next !== html && (await writeIfChanged(path, next))) {
          log("브릿지 태그 주입:", rel)
        }
      } catch (err: any) {
        log("HTML 주입 실패:", rel, err?.message)
      }
    }
  }

  return {
    event: async ({ event }: { event?: { type?: string } }) => {
      if (event?.type === "session.idle") await heal()
    },
  }
}
