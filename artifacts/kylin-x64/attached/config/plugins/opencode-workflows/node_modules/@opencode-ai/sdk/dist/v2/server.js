import { spawn } from "node:child_process";
export async function createOpencodeServer(options) {
    options = Object.assign({
        hostname: "127.0.0.1",
        port: 4096,
        timeout: 5000,
    }, options ?? {});
    const args = [`serve`, `--hostname=${options.hostname}`, `--port=${options.port}`];
    if (options.config?.logLevel)
        args.push(`--log-level=${options.config.logLevel}`);
    const proc = spawn(`opencode`, args, {
        signal: options.signal,
        env: {
            ...process.env,
            OPENCODE_CONFIG_CONTENT: JSON.stringify(options.config ?? {}),
        },
    });
    const url = await new Promise((resolve, reject) => {
        const id = setTimeout(() => {
            reject(new Error(`Timeout waiting for server to start after ${options.timeout}ms`));
        }, options.timeout);
        let output = "";
        proc.stdout?.on("data", (chunk) => {
            output += chunk.toString();
            const lines = output.split("\n");
            for (const line of lines) {
                if (line.startsWith("opencode server listening")) {
                    const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
                    if (!match) {
                        throw new Error(`Failed to parse server url from output: ${line}`);
                    }
                    clearTimeout(id);
                    resolve(match[1]);
                    return;
                }
            }
        });
        proc.stderr?.on("data", (chunk) => {
            output += chunk.toString();
        });
        proc.on("exit", (code) => {
            clearTimeout(id);
            let msg = `Server exited with code ${code}`;
            if (output.trim()) {
                msg += `\nServer output: ${output}`;
            }
            reject(new Error(msg));
        });
        proc.on("error", (error) => {
            clearTimeout(id);
            reject(error);
        });
        if (options.signal) {
            options.signal.addEventListener("abort", () => {
                clearTimeout(id);
                reject(new Error("Aborted"));
            });
        }
    });
    return {
        url,
        close() {
            proc.kill();
        },
    };
}
export function createOpencodeTui(options) {
    const args = [];
    if (options?.project) {
        args.push(`--project=${options.project}`);
    }
    if (options?.model) {
        args.push(`--model=${options.model}`);
    }
    if (options?.session) {
        args.push(`--session=${options.session}`);
    }
    if (options?.agent) {
        args.push(`--agent=${options.agent}`);
    }
    const proc = spawn(`opencode`, args, {
        signal: options?.signal,
        stdio: "inherit",
        env: {
            ...process.env,
            OPENCODE_CONFIG_CONTENT: JSON.stringify(options?.config ?? {}),
        },
    });
    return {
        close() {
            proc.kill();
        },
    };
}
