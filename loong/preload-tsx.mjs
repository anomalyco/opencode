import { register } from "node:module";

const OC_NO_TSX = process.env.OC_NO_TSX === "1";

// [boot0] global Bun polyfill (loong node port)
try {
  const { makeBun } = await import(new URL("./bun-global-shim.mjs", import.meta.url).href);
  if (typeof globalThis.Bun === "undefined") globalThis.Bun = makeBun();
} catch (e) {
  process.stderr.write("[preload] bun shim failed: " + (e?.stack || e) + "\n");
}


let registerTsx = null;
if (!OC_NO_TSX) {
  try {
    ({ register: registerTsx } = await import("tsx/esm/api"));
  } catch (e) {
    process.stderr.write("[preload] tsx import failed: " + (e?.stack || e) + "\n");
  }
  if (registerTsx) {
    try {
      const r = registerTsx();
      process.on("exit", () => r?.unregister?.());
    } catch (e) {
      process.stderr.write("[preload] tsx register failed: " + (e?.stack || e) + "\n");
    }
  }
}
try {
  register(new URL("./asset-loader.mjs", import.meta.url));
} catch (e) {
  process.stderr.write("[preload] asset register failed: " + (e?.stack || e) + "\n");
}
async function installNodeCompat() {
  const wt = await import("node:worker_threads");
  if (wt.parentPort) {
    globalThis.__oc_worker_compat = true;
    if (typeof globalThis.postMessage === "undefined") {
      const parentPort = wt.parentPort;
      globalThis.postMessage = (data) => parentPort.postMessage(data);
      Object.defineProperty(globalThis, "onmessage", {
        configurable: true,
        get: () => undefined,
        set(fn) {
          if (typeof fn === "function") {
            parentPort.on("message", (data) => fn({ data }));
          }
        },
      });
    }
  } else if (typeof globalThis.Worker === "undefined") {
    class BunLikeWorker extends wt.Worker {
      constructor(filename, options = {}) {
        super(filename, { ...options, type: "module" });
      }
    }
    Object.defineProperty(BunLikeWorker.prototype, "onmessage", {
      configurable: true,
      get: function () {
        return this._ocOnMessage || null;
      },
      set(fn) {
        this._ocOnMessage = fn;
        if (typeof fn === "function") {
          this.on("message", (data) => fn({ data }));
        }
      },
    });
    globalThis.Worker = BunLikeWorker;
  }
}

installNodeCompat().catch((e) =>
  process.stderr.write("[preload] node-compat failed: " + (e?.stack || e) + "\n"),
);

try {
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  const ffi = req("node:ffi");
  if (ffi && typeof ffi.toArrayBuffer === "function" && !ffi.__ocWrapped) {
    const orig = ffi.toArrayBuffer;
    const fsMod = await import("node:fs");
    let seq = 0;
    const ring = [];
    const fsMod2 = await import("node:fs");
    const dloRing = [];
    let dseq = 0;
    const origDlopen = ffi.dlopen;
    if (typeof origDlopen === "function" && !ffi.__ocDloWrapped) {
      ffi.__ocDloWrapped = true;
      ffi.dlopen = function (name, defs) {
        const r = origDlopen.call(this, name, defs);
        try {
          for (const [k, fn] of Object.entries(r)) {
            if (typeof fn === "function") {
              const inner = fn;
              r[k] = function (...args) {
                const a = args.map((x) => (typeof x === "bigint" ? "bi:" + x : typeof x === "number" ? "n:" + x : typeof x === "string" ? "s:" + x.slice(0, 24) : Buffer.isBuffer(x) ? "buf" + x.length : ArrayBuffer.isView(x) ? "view:" + x.byteLength : typeof x));
                dloRing.push(dseq++ + " " + String(name).split("/").pop() + " " + String(k) + " " + a.join(" "));
                if (dloRing.length > 2000) dloRing.splice(0, dloRing.length - 2000);
                return inner.apply(this, args);
              };
            }
          }
        } catch {}
        return r;
      };
    }
    ffi.__ocWrapped = true;
    ffi.toArrayBuffer = function (ptr, length, copy) {
      ring.push([seq++, typeof length, String(length), String(ptr).slice(0, 18)]);
      if (ring.length > 500) ring.splice(0, ring.length - 500);
      const bad = !(typeof length === "number" && Number.isFinite(length) && length >= 0 && length <= 8 * 1024 * 1024);
      if (bad) {
        process.stderr.write(
          "[FFI-TAB] ptr=" + String(ptr) + " len=" + String(length) + " copy=" + String(copy) + "\n" +
          (new Error("ffi-tab").stack || "").split("\n").slice(0, 14).join("\n") + "\n",
        );
      }
      return orig.call(ffi, ptr, length, copy);
    };
  }
} catch (e) {
  process.stderr.write("[preload] ffi wrap failed: " + (e?.stack || e) + "\n");
}
