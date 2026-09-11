// oc-boot4: fast bootstrap for loong — NO tsx. Uses Node native TS transform
// (--experimental-transform-types) for .ts, babel-solid for .tsx, and the
// asset-loader resolve/load hooks for '@/' + extensionless imports + assets.
process.env.OC_NO_TSX = "1"
setInterval(() => {
  try {
    const r = process._getActiveRequests().map((x) => (x.constructor.name) + " " + ((x && (x.path || x.filename)) || ""))
    process.stderr.write("[REQ] " + JSON.stringify(r) + "\n")
  } catch {}
}, 1000)

process.on("SIGUSR2", () => {
  try {
    const h = process._getActiveHandles().map((x) => (x.constructor && x.constructor.name) + " " + ((x && (x._hostname || x.path || x.filename || x._address)) || ""))
    const r = process._getActiveRequests().map((x) => (x.constructor && x.constructor.name) + " " + ((x && (x._hostname || x.path || x.filename || x._address)) || ""))
    process.stderr.write("[ACTIVE] handles=" + JSON.stringify(h) + "\n[ACTIVE] reqs=" + JSON.stringify(r) + "\n")
  } catch (e) { process.stderr.write("[ACTIVE] err " + e.message + "\n") }
})


await import(new URL("./preload-tsx.mjs", import.meta.url).href).catch((e) =>
  process.stderr.write("[boot4] preload err " + (e && e.stack ? e.stack : e) + "\n"),
)

const { register } = await import("node:module")
try {
  await import(new URL("./oc-jsxbabel-loader.mjs", import.meta.url).href)
  register(new URL("./oc-jsxbabel-loader.mjs", import.meta.url), { parentURL: import.meta.url })
  process.stderr.write("[boot4] jsx-babel registered\n")
} catch (e) {
  process.stderr.write("[boot4] jsx-babel err " + (e && e.stack ? e.stack : e) + "\n")
}
