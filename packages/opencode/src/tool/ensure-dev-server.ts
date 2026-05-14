import z from "zod"
import { spawn } from "node:child_process"
import { createConnection } from "node:net"
import { existsSync } from "node:fs"
import { Tool } from "./tool"
import DESCRIPTION from "./ensure-dev-server.txt"
import { Instance } from "../project/instance"
import { Log } from "../util/log"

const log = Log.create({ service: "ensure-dev-server" })

/**
 * 지정 포트가 LISTEN 중인지 빠르게 확인한다.
 * lsof/ss/netstat 없이 TCP connect 시도만으로 판별 — `(echo > /dev/tcp/...)` 의 Node 버전.
 */
export function probePort(port: number, host = "127.0.0.1", timeoutMs = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port })
    const done = (ok: boolean) => {
      sock.removeAllListeners()
      sock.destroy()
      resolve(ok)
    }
    sock.once("connect", () => done(true))
    sock.once("error", () => done(false))
    sock.setTimeout(timeoutMs, () => done(false))
  })
}

async function waitForPort(port: number, timeoutMs: number, abort: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (abort.aborted) return false
    if (await probePort(port)) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

export function serveUrl(port: number): string {
  // 학생에게 안내할 외부 접근 주소. JUPYTERHUB_USER/OPENCODE_SERVE_DOMAIN 환경변수가 있으면 외부 URL,
  // 없으면 로컬 URL 로 폴백.
  const user = process.env["JUPYTERHUB_USER"]
  const domain = process.env["OPENCODE_SERVE_DOMAIN"]
  if (user && domain) return `https://${user}.${domain}/`
  return `http://localhost:${port}/`
}

export const EnsureDevServerTool = Tool.define("ensure_dev_server", async () => ({
  description: DESCRIPTION,
  parameters: z.object({
    cwd: z.string().describe(`서버를 실행할 작업 디렉토리 (기본값 ${Instance.directory})`).optional(),
    cmd: z
      .string()
      .describe(
        "실행할 셸 명령. 예: 'npm run dev -- --host 0.0.0.0 --port 3000', " +
          "'npx --yes browser-sync start --server --port 3000 --files \"**/*.{html,css,js}\" --no-open --no-ui'",
      ),
    port: z.number().describe("서버가 LISTEN 할 포트. OpenCode 환경에서는 3000 고정.").default(3000),
    ready_timeout_ms: z
      .number()
      .describe("새로 띄울 때 LISTEN 시작을 기다리는 최대 시간(ms).")
      .default(15000),
  }),
  async execute(params, ctx) {
    const startedAt = Date.now()
    const cwd = params.cwd ?? Instance.directory

    type Payload = {
      status: "already_running" | "started" | "failed"
      url?: string
      port: number
      ms: number
      reason?: string
    }

    const result = (title: string, payload: Payload) => ({
      title,
      output: JSON.stringify(payload),
      metadata: payload,
    })

    if (!existsSync(cwd)) {
      return result("ensure_dev_server: failed", {
        status: "failed",
        port: params.port,
        ms: Date.now() - startedAt,
        reason: `cwd 가 존재하지 않습니다: ${cwd}`,
      })
    }

    if (await probePort(params.port)) {
      return result(`ensure_dev_server: already_running (:${params.port})`, {
        status: "already_running",
        url: serveUrl(params.port),
        port: params.port,
        ms: Date.now() - startedAt,
      })
    }

    // 권한 게이트는 bash 와 동일한 채널로 받는다. 학생 환경에선 opencode.jsonc 의 "permission": "allow" 로 자동 통과.
    await ctx.ask({
      permission: "bash",
      patterns: [params.cmd],
      always: [`ensure_dev_server :${params.port}`],
      metadata: {},
    })

    // 백그라운드 launch. detached + stdio:ignore + unref 로 OpenCode 프로세스가 stdout 파이프를 잡지 않게 한다.
    // 이게 빠지면 도구 호출이 반환되지 않고 응답 턴이 hang 된다.
    const child = spawn("/bin/sh", ["-lc", params.cmd], {
      cwd,
      detached: true,
      stdio: "ignore",
      env: process.env,
    })
    child.unref()
    log.info("spawned dev server", { pid: child.pid, port: params.port, cwd })

    const ready = await waitForPort(params.port, params.ready_timeout_ms, ctx.abort)
    const ms = Date.now() - startedAt

    if (!ready) {
      return result("ensure_dev_server: failed", {
        status: "failed",
        port: params.port,
        ms,
        reason: `포트 ${params.port} 가 ${params.ready_timeout_ms}ms 안에 LISTEN 되지 않았습니다. 명령어를 확인하세요: ${params.cmd}`,
      })
    }

    return result(`ensure_dev_server: started (:${params.port}, ${ms}ms)`, {
      status: "started",
      url: serveUrl(params.port),
      port: params.port,
      ms,
    })
  },
}))
