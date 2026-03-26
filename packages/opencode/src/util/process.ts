import { buffer } from "node:stream/consumers";
import type { ChildProcess } from "child_process";
import launch from "cross-spawn";
import { errorMessage } from "./error";

export namespace Process {
  export type Stdio = "inherit" | "pipe" | "ignore";
  export type Shell = boolean | string;

  export interface Options {
    cwd?: string;
    env?: NodeJS.ProcessEnv | null;
    stdin?: Stdio;
    stdout?: Stdio;
    stderr?: Stdio;
    shell?: Shell;
    abort?: AbortSignal;
    kill?: NodeJS.Signals | number;
    timeout?: number;
  }

  export interface RunOptions extends Omit<Options, "stdout" | "stderr"> {
    nothrow?: boolean;
  }

  export interface Result {
    code: number;
    stdout: Buffer;
    stderr: Buffer;
  }

  export interface TextResult extends Result {
    text: string;
  }

  export class RunFailedError extends Error {
    readonly cmd: string[];
    readonly code: number;
    readonly stdout: Buffer;
    readonly stderr: Buffer;

    constructor(cmd: string[], code: number, stdout: Buffer, stderr: Buffer) {
      const text = stderr.toString().trim();
      super(
        text
          ? `Command failed with code ${code}: ${cmd.join(" ")}\n${text}`
          : `Command failed with code ${code}: ${cmd.join(" ")}`
      );
      this.name = "ProcessRunFailedError";
      this.cmd = [...cmd];
      this.code = code;
      this.stdout = stdout;
      this.stderr = stderr;
    }
  }

  export type Child = ChildProcess & { exited: Promise<number> };

  export function spawn(cmd: string[], opts: Options = {}): Child {
    if (cmd.length === 0) throw new Error("Command is required");
    opts.abort?.throwIfAborted();

    const proc = launch(cmd[0], cmd.slice(1), {
      cwd: opts.cwd,
      shell: opts.shell,
      env: opts.env === null ? {} : opts.env ? { ...process.env, ...opts.env } : undefined,
      stdio: [opts.stdin ?? "ignore", opts.stdout ?? "ignore", opts.stderr ?? "ignore"],
      windowsHide: process.platform === "win32",
    });

    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const abort = () => {
      if (closed) return;
      if (proc.exitCode !== null || proc.signalCode !== null) return;
      closed = true;

      proc.kill(opts.kill ?? "SIGTERM");

      const ms = opts.timeout ?? 5_000;
      if (ms <= 0) return;
      timer = setTimeout(() => proc.kill("SIGKILL"), ms);
    };

    const exited = new Promise<number>((resolve, reject) => {
      let settled = false;
      let poll: ReturnType<typeof setInterval> | undefined;
      const done = () => {
        opts.abort?.removeEventListener("abort", abort);
        if (timer) clearTimeout(timer);
        if (poll) clearInterval(poll);
      };

      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        done();
        resolve(code);
      };

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        done();
        reject(error);
      };

      proc.once("exit", (code, signal) => {
        finish(code ?? (signal ? 1 : 0));
      });

      proc.once("close", (code, signal) => {
        finish(code ?? (signal ? 1 : 0));
      });

      proc.once("error", fail);

      // Polling watchdog: detect process exit when Bun's event loop
      // fails to deliver the "exit" event (confirmed Bun bug in containers)
      poll = setInterval(() => {
        if (proc.exitCode !== null || proc.signalCode !== null) {
          finish(proc.exitCode ?? (proc.signalCode ? 1 : 0));
          return;
        }
        if (proc.pid && process.platform !== "win32") {
          try {
            process.kill(proc.pid, 0);
          } catch {
            finish(proc.exitCode ?? 0);
            return;
          }
        }
      }, 1000);
    });
    void exited.catch(() => undefined);

    if (opts.abort) {
      opts.abort.addEventListener("abort", abort, { once: true });
      if (opts.abort.aborted) abort();
    }

    const child = proc as Child;
    child.exited = exited;
    return child;
  }

  export async function run(cmd: string[], opts: RunOptions = {}): Promise<Result> {
    const proc = spawn(cmd, {
      cwd: opts.cwd,
      env: opts.env,
      stdin: opts.stdin,
      shell: opts.shell,
      abort: opts.abort,
      kill: opts.kill,
      timeout: opts.timeout,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (!proc.stdout || !proc.stderr) throw new Error("Process output not available");

    // Watchdog: if streams don't drain within 5s after process exit,
    // force-close them. Handles Bun zombie pipe bug where EOF is never
    // delivered on child process pipes.
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const out = await Promise.all([
      proc.exited.then((code) => {
        watchdog = setTimeout(() => {
          proc.stdout?.destroy();
          proc.stderr?.destroy();
        }, 5_000);
        return code;
      }),
      buffer(proc.stdout),
      buffer(proc.stderr),
    ])
      .then(([code, stdout, stderr]) => {
        if (watchdog) clearTimeout(watchdog);
        return { code, stdout, stderr };
      })
      .catch((err: unknown) => {
        if (watchdog) clearTimeout(watchdog);
        if (!opts.nothrow) throw err;
        return {
          code: 1,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(errorMessage(err)),
        };
      });
    if (out.code === 0 || opts.nothrow) return out;
    throw new RunFailedError(cmd, out.code, out.stdout, out.stderr);
  }

  export async function stop(proc: ChildProcess) {
    if (process.platform !== "win32" || !proc.pid) {
      proc.kill();
      return;
    }

    const out = await run(["taskkill", "/pid", String(proc.pid), "/T", "/F"], {
      nothrow: true,
    });

    if (out.code === 0) return;
    proc.kill();
  }

  export async function text(cmd: string[], opts: RunOptions = {}): Promise<TextResult> {
    const out = await run(cmd, opts);
    return {
      ...out,
      text: out.stdout.toString(),
    };
  }

  export async function lines(cmd: string[], opts: RunOptions = {}): Promise<string[]> {
    return (await text(cmd, opts)).text.split(/\r?\n/).filter(Boolean);
  }
}
