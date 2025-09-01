import { Provider } from "../../provider/provider"
import { Server } from "../../server/server"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"
import { Auth } from "../../auth"
import path from "path"
import { ModelsDev } from "../../provider/models"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) =>
    yargs
      .option("docker", {
        type: "boolean",
        describe: "run server in docker with current dir mounted",
      })
      .option("docker-image", {
        type: "string",
        describe: "docker image for server",
        default: "opencodeai/opencode:server",
        alias: ["dockerImage"],
      })
      .option("dockerfile", {
        type: "string",
        describe: "path to a local Dockerfile to build before running",
      })
      .option("docker-context", {
        type: "string",
        describe: "docker build context directory (defaults to Dockerfile's dir)",
        alias: ["dockerContext"],
      })
      .option("docker-build", {
        type: "boolean",
        describe: "force build the docker image before running",
        alias: ["dockerBuild"],
      })
      .option("port", {
        alias: ["p"],
        type: "number",
        describe: "port to listen on",
        default: 0,
      })
      .option("hostname", {
        alias: ["h"],
        type: "string",
        describe: "hostname to listen on",
        default: "127.0.0.1",
      }),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    const cwd = process.cwd()
    await bootstrap(cwd, async () => {
      const providers = await Provider.list()
      if (Object.keys(providers).length === 0) {
        return "needs_provider"
      }

      const srv = await (async () => {
        if (!args.docker) return Server.listen({ port: args.port, hostname: args.hostname })
        const docker = Bun.which("docker")
        if (!docker) return Server.listen({ port: args.port, hostname: args.hostname })
        const df = (args as { dockerfile?: string }).dockerfile
        const needBuild = !!df || (args as { dockerBuild?: boolean }).dockerBuild === true
        const img = await (async () => {
          const defaultImg = "opencodeai/opencode:server"
          if (!needBuild) return (args as { dockerImage?: string }).dockerImage ?? defaultImg
          const f = df ?? "Dockerfile"
          const ctx = (args as { dockerContext?: string }).dockerContext ?? path.dirname(path.resolve(f))
          const base = (args as { dockerImage?: string }).dockerImage ?? defaultImg
          const tag = base === defaultImg ? "opencode:local" : base
          const b = Bun.spawn({ cmd: [docker, "build", "-t", tag, "-f", f, ctx], stdout: "inherit", stderr: "inherit" })
          const code = await b.exited
          if (code !== 0) return base
          return tag
        })()
        const alloc = () => {
          const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") })
          const p = s.port
          s.stop()
          return p
        }
        const port = args.port && args.port > 0 ? args.port : alloc()
        const host = args.hostname ?? "127.0.0.1"
        const cport = 8080
        const vol = process.cwd() + ":/workspace"
        const db = await ModelsDev.get()
        const envlist: string[] = []
        for (const p of Object.values(db)) {
          for (const k of p.env) {
            const v = process.env[k]
            if (v) envlist.push(`${k}=${v}`)
          }
        }
        const cmd = [
          docker,
          "run",
          "--rm",
          "-d",
          "-p",
          `${port}:${cport}`,
          "-v",
          vol,
          "-w",
          "/workspace",
          ...envlist.flatMap((e) => ["-e", e]),
          img,
          "bun",
          "run",
          "/app/src/index.ts",
          "serve",
          "--hostname",
          "0.0.0.0",
          "--port",
          String(cport),
        ]
        const p = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe" })
        const code = await p.exited
        const id = await new Response(p.stdout).text().then((x) => x.trim())
        if (code !== 0 || !id) return Server.listen({ port: args.port, hostname: args.hostname })
        const url = new URL("http://" + host + ":" + String(port))
        const until = Date.now() + 20_000
        while (Date.now() < until) {
          const ok = await fetch(new URL("/doc", url)).then((r) => r.ok).catch(() => false)
          if (ok) break
          await Bun.sleep(200)
        }
        return {
          hostname: host,
          port,
          url,
          stop: async () => {
            const stop = Bun.spawn({ cmd: [docker, "stop", id], stdout: "ignore", stderr: "inherit" })
            await stop.exited
          },
        }
      })()

      if (args.docker) {
        const auth = await Auth.all()
        await Promise.all(
          Object.entries(auth).map(([id, info]) =>
            fetch(new URL("/auth/" + encodeURIComponent(id), srv.url), {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(info),
            }).catch(() => {}),
          ),
        )
      }

      console.log(`opencode server listening on http://${srv.hostname}:${srv.port}`)

      await new Promise(() => {})

      srv.stop()
    })
  },
})
