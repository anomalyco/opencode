import { tool } from "@opencode-ai/plugin"
import { spawn } from "node:child_process"
import { createConnection } from "node:net"
import { existsSync } from "node:fs"

/**
 * 지정 포트가 LISTEN 중인지 빠르게 확인한다.
 * lsof/ss/netstat 없이 TCP connect 시도만으로 판별 — `(echo > /dev/tcp/...)` 의 Node 버전.
 */
function probePort(port: number, host = "127.0.0.1", timeoutMs = 250): Promise<boolean> {
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

async function waitForPort(port: number, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal.aborted) return false
    if (await probePort(port)) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

function serveUrl(port: number): string {
  // 학생에게 안내할 외부 접근 주소. JUPYTERHUB_USER/OPENCODE_SERVE_DOMAIN 환경변수가 있으면 외부 URL,
  // 없으면 로컬 URL 로 폴백.
  const user = process.env.JUPYTERHUB_USER
  const domain = process.env.OPENCODE_SERVE_DOMAIN
  if (user && domain) return `https://${user}.${domain}/`
  return `http://localhost:${port}/`
}

export default tool({
  description: `결과물 미리보기용 dev 서버가 지정 포트에서 LISTEN 중인지 확인하고, 없으면 백그라운드로 띄운다.

이미 LISTEN 중이면 즉시 반환한다(서버를 재시작하지 않음). 없으면 detached 백그라운드 프로세스로 launch 한 뒤 포트가 LISTEN 될 때까지 폴링한다.

매 응답 턴마다 이 도구를 한 번 호출하면 idempotent 하게 미리보기 환경이 보장된다.
직접 nohup/sleep 으로 launch 명령을 짜지 말고 항상 이 도구를 쓴다.`,
  args: {
    cwd: tool.schema.string().describe("서버를 실행할 작업 디렉토리 (예: /home/jovyan/project)"),
    cmd: tool.schema
      .string()
      .describe(
        "실행할 셸 명령. 예: 'npm run dev -- --host 0.0.0.0 --port 3000', " +
          "'npx --yes browser-sync start --server --port 3000 --files \"**/*.{html,css,js}\" --no-open --no-ui'",
      ),
    port: tool.schema.number().describe("서버가 LISTEN 할 포트. OpenCode 환경에서는 3000 고정.").default(3000),
    ready_timeout_ms: tool.schema
      .number()
      .describe("새로 띄울 때 LISTEN 시작을 기다리는 최대 시간(ms).")
      .default(15000),
  },
  async execute(args) {
    const startedAt = Date.now()

    if (!existsSync(args.cwd)) {
      return JSON.stringify({
        status: "failed",
        reason: `cwd 가 존재하지 않습니다: ${args.cwd}`,
        ms: Date.now() - startedAt,
      })
    }

    if (await probePort(args.port)) {
      return JSON.stringify({
        status: "already_running",
        url: serveUrl(args.port),
        port: args.port,
        ms: Date.now() - startedAt,
      })
    }

    // 백그라운드 launch. detached + stdio:ignore + unref 로 OpenCode 프로세스가 stdout 파이프를 잡지 않게 한다.
    // 이게 빠지면 도구 호출이 반환되지 않고 응답 턴이 hang 된다.
    const child = spawn("/bin/sh", ["-lc", args.cmd], {
      cwd: args.cwd,
      detached: true,
      stdio: "ignore",
      env: process.env,
    })
    child.unref()

    const ready = await waitForPort(args.port, args.ready_timeout_ms, AbortSignal.timeout(args.ready_timeout_ms + 1000))
    const ms = Date.now() - startedAt

    if (!ready) {
      return JSON.stringify({
        status: "failed",
        reason: `포트 ${args.port} 가 ${args.ready_timeout_ms}ms 안에 LISTEN 되지 않았습니다. 명령어를 확인하세요: ${args.cmd}`,
        ms,
      })
    }

    return JSON.stringify({
      status: "started",
      url: serveUrl(args.port),
      port: args.port,
      ms,
    })
  },
})
