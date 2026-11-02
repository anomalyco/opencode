export * as SandboxFileWorker from "./file-worker.js"

import type { SandboxPolicy } from "./policy.js"
import { SandboxFileProtocol } from "./file-protocol.js"

// Fixed, dependency-free JavaScript embedded in source and compiled distributions alike.
// Paths and binary data arrive on stdin; none of the request becomes executable code.
export function configured(policy?: SandboxPolicy.Policy) {
  return String.raw`
const writePolicy = ${JSON.stringify(policy ?? null)};
void (async () => {
  const fs = require("node:fs/promises");
  const constants = require("node:fs").constants;
  const path = require("node:path");
  const MAX_DATA = ${SandboxFileProtocol.MAX_DATA_BYTES};
  const MAX_FRAME = ${SandboxFileProtocol.MAX_FRAME_BYTES};
  const MAX_ENTRIES = ${SandboxFileProtocol.MAX_ENTRIES};
  const type = (entry) => entry.isFile() ? "file" : entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "other";
  const info = (entry) => ({ type: type(entry), size: entry.size, mtimeMs: entry.mtimeMs });
  const fail = (message) => { throw Object.assign(new Error(message), { kind: "Failed" }); };
  const wrong = (actual) => { throw Object.assign(new Error("Unexpected file type: " + actual), { kind: "WrongKind", actual }); };
  const validPath = (value) => typeof value === "string" && value.length <= 32768 && path.isAbsolute(value) && !value.includes("\0");
  const integer = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
  const decode = (data) => {
    if (typeof data !== "string" || data.length > Math.ceil(MAX_DATA / 3) * 4) fail("Invalid or oversized binary data");
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > MAX_DATA || bytes.toString("base64") !== data) fail("Invalid or oversized binary data");
    return bytes;
  };
  const send = (reply) => {
    const frame = JSON.stringify(reply);
    if (Buffer.byteLength(frame) > MAX_FRAME) fail("File helper reply exceeds its collection limit");
    process.stdout.write(frame);
  };
  let reportMissing = false;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > MAX_FRAME) fail("File helper request exceeds its collection limit");
      chunks.push(chunk);
    }
    const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!request || !["read", "write", "stat", "list", "mkdir", "remove", "move", "check"].includes(request.op) || !validPath(request.path)) fail("Invalid file helper request");
    if (request.op === "move" && !validPath(request.to)) fail("Invalid move destination");
    if (request.op === "read" && request.range !== undefined &&
        (!request.range || !integer(request.range.offset, Number.MAX_SAFE_INTEGER) || !integer(request.range.length, MAX_DATA) || !Number.isSafeInteger(request.range.offset + request.range.length))) fail("Invalid byte range");
    reportMissing = ["read", "stat", "list"].includes(request.op);
    if (request.op === "check") {
      if (!writePolicy || !["write", "remove"].includes(request.operation)) fail("Invalid write preflight");
      const contains = (root, target) => { const relative = path.relative(root, target); return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)); };
      // Resolve existing parents inside the helper, including aliases above missing paths.
      // This check does not reserve paths; Seatbelt checks again at the actual mutation.
      const resolve = async (value) => {
        try { return await fs.realpath(value); }
        catch (error) {
          if (error.code !== "ENOENT") throw error;
          const entry = await fs.lstat(value).catch((error) => { if (error.code === "ENOENT") return undefined; throw error; });
          if (entry && entry.isSymbolicLink()) {
            const link = await fs.readlink(value);
            return resolve(path.resolve(path.dirname(value), link));
          }
          const parent = path.dirname(value);
          if (parent === value) throw error;
          return path.join(await resolve(parent), path.basename(value));
        }
      };
      const lexical = path.resolve(request.path);
      const canonical = request.operation === "remove"
        ? path.join(await resolve(path.dirname(lexical)), path.basename(lexical))
        : await resolve(lexical);
      for (const value of [lexical, canonical]) {
        if (!writePolicy.writableRoots.some((root) => contains(root, value)) ||
            writePolicy.protectedPaths.some((root) => contains(root, value)) ||
            writePolicy.unreadablePaths.some((root) => contains(root, value)) ||
            (request.operation === "remove" && (writePolicy.writableRoots.includes(value) || writePolicy.protectedPaths.some((root) => contains(value, root)))))
          fail("Sandbox blocks " + request.operation + " at " + request.path + ". Use the shell tool with sandbox_permissions=require_escalated and a justification to request access outside the sandbox.");
      }
      if (request.operation === "write") {
        const entry = await fs.stat(lexical).catch((error) => { if (error.code === "ENOENT") return undefined; throw error; });
        if (entry) {
          if (!entry.isFile()) fail("Write target is not a regular file");
          const handle = await fs.open(lexical, constants.O_WRONLY | constants.O_NONBLOCK);
          await handle.close();
        }
      }
      send({ op: "check" }); return;
    }
    if (request.op === "read") {
      // Nonblocking open prevents a file replaced by a FIFO from hanging before fstat.
      const handle = await fs.open(request.path, constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        const metadata = info(await handle.stat());
        if (metadata.type !== "file") wrong(metadata.type);
        if (!request.range && metadata.size > MAX_DATA) fail("File exceeds the read limit; request a byte range");
        const limit = request.range ? request.range.length : MAX_DATA + 1;
        const bytes = [];
        let count = 0;
        while (count < limit) {
          const buffer = Buffer.alloc(Math.min(64 * 1024, limit - count));
          const result = await handle.read(buffer, 0, buffer.length, (request.range ? request.range.offset : 0) + count);
          if (result.bytesRead === 0) break;
          count += result.bytesRead;
          if (count > MAX_DATA) fail("File exceeds the read limit; request a byte range");
          bytes.push(buffer.subarray(0, result.bytesRead));
        }
        send({ op: "read", info: metadata, data: Buffer.concat(bytes, count).toString("base64") });
      } finally { await handle.close(); }
      return;
    }
    if (request.op === "stat") { send({ op: "stat", info: info(await fs.lstat(request.path)) }); return; }
    if (request.op === "list") {
      const metadata = info(await fs.stat(request.path));
      if (metadata.type !== "directory") wrong(metadata.type);
      const entries = [];
      let size = 0;
      for await (const entry of await fs.opendir(request.path)) {
        size += Buffer.byteLength(entry.name) + 64;
        if (entries.length >= MAX_ENTRIES || size > MAX_DATA) fail("Directory exceeds the listing limit");
        entries.push({ name: entry.name, type: type(entry) });
      }
      send({ op: "list", entries }); return;
    }
    if (request.op === "write") {
      const bytes = decode(request.data);
      await fs.mkdir(path.dirname(request.path), { recursive: true });
      await fs.writeFile(request.path, bytes, { flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NONBLOCK });
    }
    if (request.op === "mkdir") await fs.mkdir(request.path, { recursive: true });
    if (request.op === "remove") await fs.rm(request.path, { recursive: true, force: true });
    if (request.op === "move") {
      reportMissing = true;
      await fs.lstat(request.path);
      reportMissing = false;
      const target = await fs.lstat(request.to).catch((error) => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
        throw error;
      });
      await fs.rename(request.path, target && target.isDirectory() ? path.join(request.to, path.basename(request.path)) : request.to);
    }
    send({ op: request.op });
  } catch (error) {
    const missing = reportMissing && error && (error.code === "ENOENT" || error.code === "ENOTDIR");
    send({ op: "error", kind: error.kind || (missing ? "NotFound" : "Failed"), actual: error.actual, message: String(error.message || error).slice(0, 8192) });
  }
})().catch(() => { process.exitCode = 1; });
`
}

export const program = configured()
