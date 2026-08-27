import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { execFile, execFileSync, spawn } from "node:child_process"
import { createServer, type Socket } from "node:net"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { Cause, Deferred, Effect, Exit, Fiber, Schema, Scope, Stream } from "effect"
import { ForegroundProcess } from "../src/process.ts"

const windows = process.platform === "win32"
const node = windows
  ? execFileSync("node", ["-p", "process.execPath"], { encoding: "utf8", windowsHide: true }).trim()
  : process.execPath
const powershell = windows
  ? execFileSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", "(Get-Process -Id $PID).Path"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim()
  : ""
const js = (source: string): ForegroundProcess.Command => ({ executable: node, args: ["-e", source] })
const ps = (source: string): ForegroundProcess.Command => ({
  executable: powershell,
  args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", source],
})

describe("foreground process", { skip: !windows, timeout: 120000 }, () => {
  test("one command produces an exit code and complete raw output", async () => {
    const result = await Effect.runPromise(
      ForegroundProcess.run(
        js("require('fs').writeSync(1,'stdout');require('fs').writeSync(2,'stderr');process.exit(7)"),
      ),
    )
    assert.equal(result.exitCode, 7)
    assert.equal(result.stdout.toString(), "stdout")
    assert.equal(result.stderr.toString(), "stderr")
  })

  test("matches the host's Windows exit-code representation", async () => {
    for (const code of [-42, -1, 0, 7, 255, 256, 259, 300, 65537]) {
      const command = js(`process.exit(${code})`)
      assert.deepEqual(await Effect.runPromise(ForegroundProcess.run(command)), await baseline(command))
    }
  })

  test("preserves large binary output and both final tails", async () => {
    for (const size of [1, 4096, 65535, 65536, 65537, 1048576, 16777216]) {
      const result = await Effect.runPromise(
        ForegroundProcess.run(
          js(
            `const fs=require('fs');fs.writeSync(1,Buffer.alloc(${size},0x82));fs.writeSync(2,Buffer.alloc(${size},0xff));fs.writeSync(1,'OUT');fs.writeSync(2,'ERR')`,
          ),
        ),
      )
      assert.equal(result.exitCode, 0)
      assert.deepEqual(result.stdout, Buffer.concat([Buffer.alloc(size, 0x82), Buffer.from("OUT")]))
      assert.deepEqual(result.stderr, Buffer.concat([Buffer.alloc(size, 0xff), Buffer.from("ERR")]))
    }
  })

  test("matches PowerShell encoding and native pipeline exit status", async () => {
    for (const source of [
      "[Console]::OutputEncoding.CodePage; [Console]::InputEncoding.CodePage; [Console]::IsOutputRedirected; [Console]::OpenStandardOutput().CanSeek",
      "$text = node -e 'process.stdout.write(Buffer.from([0x82]))'; if ($text -eq [string][char]0xe9) { Write-Output matched; exit 0 }; Write-Output mismatch; exit 7",
      "[Console]::Write([char]0x00e9); [Console]::Error.Write([char]0x03bb)",
      "if (Test-Path Env:PROMPT) { $env:PROMPT } else { 'unset' }",
    ])
      assert.deepEqual(await Effect.runPromise(ForegroundProcess.run(ps(source))), await baseline(ps(source)))
  })

  test("preserves argument boundaries and environment omission", async () => {
    const args = ["", "two words", "trailing\\", 'a"b', '\\"', "$HOME; | &", "line\nline", "\u00e9\u03bb\u4e2d"]
    const command = {
      executable: node,
      args: [
        "-e",
        "process.stdout.write(JSON.stringify({args:process.argv.slice(1),removed:process.env.CAPTURE_REMOVE,kept:process.env.CAPTURE_KEEP}))",
        ...args,
      ],
      env: { ...process.env, CAPTURE_REMOVE: undefined, CAPTURE_KEEP: "kept" },
    }
    assert.deepEqual(await Effect.runPromise(ForegroundProcess.run(command)), await baseline(command))
  })

  test("preserves the host runtime's child pipe mode", async () => {
    const command = ps(
      `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class CaptureMode { [StructLayout(LayoutKind.Sequential)] public struct IO { public IntPtr Status; public UIntPtr Information; } [DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int n); [DllImport("ntdll.dll")] public static extern int NtQueryInformationFile(IntPtr f, out IO io, out uint mode, uint len, int cls); }'; $io = New-Object CaptureMode+IO; [uint32]$mode = 0; $status = [CaptureMode]::NtQueryInformationFile([CaptureMode]::GetStdHandle(-11), [ref]$io, [ref]$mode, 4, 16); Write-Output "status=$status mode=$mode"`,
    )
    assert.deepEqual(await Effect.runPromise(ForegroundProcess.run(command)), await baseline(command))
  })

  test("matches inherited, empty, and replacement environments with explicit cwd", async () => {
    for (const env of [undefined, {}, { CAPTURE_DEFINED: "value", CAPTURE_REMOVED: undefined }]) {
      const command = {
        ...js(
          "process.stdout.write(JSON.stringify({cwd:process.cwd(),keys:Object.keys(process.env).sort(),defined:process.env.CAPTURE_DEFINED}))",
        ),
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env,
      }
      assert.deepEqual(await Effect.runPromise(ForegroundProcess.run(command)), await baseline(command))
    }
  })

  test("exit observation does not discard unread output", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const child = yield* ForegroundProcess.start(js("require('fs').writeSync(1,'tail')"))
          assert.equal(yield* child.exitCode, 0)
          assert.equal(Buffer.concat(yield* Stream.runCollect(child.stdout)).toString(), "tail")
        }),
      ),
    )
  })

  test("foreground capture finishes while descendants retain writers", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const control = yield* listen()
          const descendant = `const fs=require('fs');const s=require('net').connect(${control.port},'127.0.0.1',()=>process.send('ready'));s.on('data',()=>{try{fs.writeSync(1,'LATE');s.end('written')}catch(e){s.end(e.code)}});s.on('close',()=>process.exit(0));s.on('error',()=>process.exit(0))`
          const command = js(
            `const fs=require('fs');const child=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:['ignore','inherit','inherit','ipc']});child.unref();child.once('message',()=>{child.disconnect();fs.writeSync(1,Buffer.alloc(1048576,97));fs.writeSync(2,Buffer.alloc(1048576,98));process.exit(17)})`,
          )
          const captured = yield* Effect.forkScoped(ForegroundProcess.run(command))
          const socket = yield* Effect.promise(() => control.connected)
          const result = yield* Fiber.join(captured)
          assert.equal(result.exitCode, 17)
          assert.deepEqual(result.stdout, Buffer.alloc(1048576, 97))
          assert.deepEqual(result.stderr, Buffer.alloc(1048576, 98))
          // The descendant cannot exit until instructed here: no sleep-based completion assertion.
          const response = once(socket, "data")
          socket.write("write after cutoff")
          const [bytes] = yield* Effect.promise(() => response)
          assert.equal(String(bytes), "EPIPE")
        }),
      ),
    )
  })

  test("interrupted readers leave the pending bytes for the next subscriber", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const control = yield* listen()
          const child = yield* ForegroundProcess.start(
            js(
              `const s=require('net').connect(${control.port},'127.0.0.1');s.on('data',()=>{require('fs').writeSync(1,'retained');s.end()});s.on('error',()=>process.exit(1))`,
            ),
          )
          const socket = yield* Effect.promise(() => control.connected)
          const reader = yield* Effect.forkScoped(Stream.runCollect(child.stdout))
          yield* Effect.yieldNow
          yield* Fiber.interrupt(reader)
          socket.write("produce output")
          assert.equal(Buffer.concat(yield* Stream.runCollect(child.stdout)).toString(), "retained")
          assert.equal(yield* child.exitCode, 0)
        }),
      ),
    )
  })

  test("acquisition in a closed scope releases without hanging", async () => {
    const scope = Scope.makeUnsafe()
    await Effect.runPromise(Scope.close(scope, Exit.void))
    const started = performance.now()
    const child = await Effect.runPromise(
      ForegroundProcess.start(
        js("require('net').createServer().listen(0,'127.0.0.1');setTimeout(()=>process.exit(0),10000).unref()"),
      ).pipe(Effect.provideService(Scope.Scope, scope)),
    )
    assert.throws(() => process.kill(child.pid, 0))
    assert(performance.now() - started < 5000)
  })

  test("scope interruption joins termination of the running process tree", async () => {
    const pids = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ready = yield* Deferred.make<{ parent: number; descendant: number }>()
          const fiber = yield* Effect.forkScoped(
            Effect.scoped(
              Effect.gen(function* () {
                const child = yield* ForegroundProcess.start(
                  js(
                    "const child=require('child_process').spawn(process.execPath,['-e',`require('net').createServer().listen(0,'127.0.0.1');setTimeout(()=>process.exit(0),10000).unref()`],{stdio:'inherit'});console.log(JSON.stringify({parent:process.pid,descendant:child.pid}));require('net').createServer().listen(0,'127.0.0.1');setTimeout(()=>process.exit(0),10000).unref()",
                  ),
                )
                const line = yield* child.stdout.pipe(
                  Stream.decodeText(),
                  Stream.splitLines,
                  Stream.take(1),
                  Stream.mkString,
                )
                const pids = Schema.decodeUnknownSync(
                  Schema.fromJsonString(Schema.Struct({ parent: Schema.Int, descendant: Schema.Int })),
                )(line)
                yield* Deferred.succeed(ready, pids)
                yield* Effect.never
              }),
            ),
          )
          const pids = yield* Deferred.await(ready)
          const started = performance.now()
          yield* Fiber.interrupt(fiber)
          const exit = yield* Fiber.await(fiber)
          assert(Exit.isFailure(exit))
          assert(Cause.hasInterruptsOnly(exit.cause), Cause.pretty(exit.cause))
          assert(performance.now() - started < 5000)
          return pids
        }),
      ),
    )
    assert.throws(() => process.kill(pids.parent, 0))
    assert.throws(() => process.kill(pids.descendant, 0))
  })

  test("invalid launches produce a typed failure", async () => {
    const exit = await Effect.runPromise(
      Effect.exit(ForegroundProcess.run({ executable: "C:/missing-capture-fixture.exe" })),
    )
    assert(Exit.isFailure(exit))
    assert(Cause.hasFails(exit.cause))
    assert(Cause.pretty(exit.cause).includes("ProcessError"))
  })

  test("combined output rejects resubscription instead of hiding discarded read-ahead", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const child = yield* ForegroundProcess.start(
            js("require('fs').writeSync(1,'out');require('fs').writeSync(2,'err')"),
          )
          yield* child.output.pipe(Stream.take(1), Stream.runDrain)
          const exit = yield* Effect.exit(Stream.runDrain(child.output))
          assert(Exit.isFailure(exit))
          assert(Cause.pretty(exit.cause).includes("Combined output supports one subscription"))
          yield* child.exitCode
        }),
      ),
    )
  })

  for (const mode of ["getter", "reentry", "cancelled-write", "worker", "close"])
    test(`native ${mode} safety regression`, async () => {
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          process.execPath,
          [fileURLToPath(new URL("./safety.cjs", import.meta.url)), mode, node],
          { timeout: 15000, windowsHide: true },
          (error, stdout, stderr) => {
            if (error) return reject(new Error(`${mode} failed: ${stdout}\n${stderr}`, { cause: error }))
            resolve(stdout)
          },
        )
      })
      assert.match(stdout, /passed/)
    })
})

function baseline(command: ForegroundProcess.Command) {
  return new Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }>((resolve, reject) => {
    const child = spawn(command.executable, command.args ?? [], {
      cwd: command.cwd,
      env: command.env,
      windowsHide: true,
      stdio: ["ignore", "overlapped", "overlapped"],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout?.on("data", (bytes: Buffer) => stdout.push(bytes))
    child.stderr?.on("data", (bytes: Buffer) => stderr.push(bytes))
    child.once("error", reject)
    child.once("close", (code) =>
      code === null
        ? reject(new Error("Baseline interrupted"))
        : resolve({ exitCode: code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }),
    )
  })
}

const listen = () =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const server = createServer()
      let socket: Socket | undefined
      const connected = new Promise<Socket>((resolve) =>
        server.once("connection", (connection) => {
          socket = connection
          resolve(connection)
        }),
      )
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const address = server.address()
      assert(address && typeof address !== "string")
      return {
        port: address.port,
        connected,
        close: () => {
          socket?.destroy()
          return new Promise<void>((resolve) => server.close(() => resolve()))
        },
      }
    }),
    (control) => Effect.promise(control.close),
  )
