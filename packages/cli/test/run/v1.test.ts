import { expect, test } from "bun:test"
import { isolatedEnv } from "../fixture/environment"
import { tmpdir } from "../fixture/tmpdir"

test("run v1 bridge changes directory from Git Bash PWD on Windows", async () => {
  await using directory = await tmpdir()
  const shellPWD =
    process.platform === "win32"
      ? directory.path.replace(/^([A-Za-z]:)[\\/]/, (_, drive) => `/${drive[0].toLowerCase()}/`).replaceAll("\\", "/")
      : directory.path
  const requests: string[] = []
  const location = {
    directory: directory.path,
    project: { id: "project", directory: directory.path, canonical: directory.path },
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url).pathname)
      if (new URL(request.url).pathname === "/api/location") return Response.json(location)
      return new Response(null, { status: 503 })
    },
  })
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `const { runV1Bridge } = await import("./src/run/v1")
       await runV1Bridge({ message: ["Hello"], file: [], format: "json", server: ${JSON.stringify(server.url.toString())} })
       console.log(process.cwd())`,
    ],
    {
      cwd: import.meta.dir + "/../..",
      env: isolatedEnv(directory.path, { PWD: shellPWD }),
      signal: AbortSignal.timeout(25_000),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  try {
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
    const exitCode = await child.exited
    expect(requests).toContain("/api/location")
    expect(stdout).toContain(directory.path)
    expect(stderr).not.toContain("Failed to change directory")
    expect(exitCode).toBe(1)
  } finally {
    child.kill()
    await child.exited
    await server.stop(true)
  }
}, 30_000)
