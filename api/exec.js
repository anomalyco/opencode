import { exec } from "child_process";

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const token = req.headers["x-exec-token"] || "";
  if (process.env.EXEC_TOKEN && token !== process.env.EXEC_TOKEN) {
    return res.status(401).json({ error: "invalid token" });
  }

  const { command } = req.body || {};
  if (!command || typeof command !== "string") {
    return res.status(400).json({ error: "command required" });
  }

  const blacklist = ["rm -rf", "sudo", ":(){:|:&};:"];
  if (blacklist.some(b => command.includes(b))) {
    return res.status(400).json({ error: "command not allowed" });
  }

  exec(command, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    res.status(200).json({
      stdout: String(stdout || ""),
      stderr: String(stderr || ""),
      error: err ? String(err.message) : null,
      code: err?.code ?? 0,
    });
  });
}
