import { exec as localExec } from "child_process";
import { remoteExec } from "./remoteRunner";

const EXEC_MODE = process.env.EXEC_MODE || "local";

export async function runCommand(command: string) {
  if (EXEC_MODE === "remote") {
    return await remoteExec(command);
  }

  return new Promise((resolve) => {
    localExec(command, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        error: err ? String(err.message) : null,
        code: err?.code ?? 0,
      });
    });
  });
}
