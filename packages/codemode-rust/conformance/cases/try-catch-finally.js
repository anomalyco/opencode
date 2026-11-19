const log = []
const f = () => { try { log.push("try"); throw new Error("x") } catch (e) { log.push("catch " + e.message); return "from catch" } finally { log.push("finally") } }
const r = f()
try { log.push("no throw") } catch { log.push("unreachable") } finally { log.push("finally2") }
return [r, log]
