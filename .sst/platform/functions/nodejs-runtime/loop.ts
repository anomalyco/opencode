import { Worker } from "node:worker_threads";
import { createInterface } from "node:readline";

interface WorkerStartMessage {
  type: "worker.start";
  workerID: string;
  env: Record<string, string>;
  args: string[];
}
interface WorkerStopMessage {
  type: "worker.stop";
  workerID: string;
}
type Message = WorkerStartMessage | WorkerStopMessage;

const rl = createInterface({
  input: process.stdin,
  terminal: false,
});

const workers = new Map<string, Worker>();
rl.on("line", (line) => {
  const msg = JSON.parse(line) as Message;
  if (msg.type === "worker.start") {
    const worker = new Worker(new URL("./index.js", import.meta.url).pathname, {
      env: {
        ...msg.env,
        SST_LIVE: "true",
        SST_DEV: "true",
      },
      execArgv: ["--enable-source-maps", "--inspect"],
      argv: msg.args,
      stderr: true,
      stdin: true,
      stdout: true,
    });
    worker.stdout.on("data", (data: Buffer) => {
      console.log(
        JSON.stringify({
          type: "worker.out",
          workerID: msg.workerID,
          data: data.toString(),
        }),
      );
    });
    worker.stderr.on("data", (data: Buffer) => {
      console.log(
        JSON.stringify({
          type: "worker.out",
          workerID: msg.workerID,
          data: data.toString(),
        }),
      );
    });
    workers.set(msg.workerID, worker);
    worker.on("exit", () => {
      console.log(
        JSON.stringify({ type: "worker.exit", workerID: msg.workerID }),
      );
      workers.delete(msg.workerID);
    });
  }

  if (msg.type === "worker.stop") {
    const worker = workers.get(msg.workerID);
    if (worker) {
      worker.terminate();
    }
  }
});

process.on("SIGTERM", () => {
  process.exit(0);
});
