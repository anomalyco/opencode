const r = []
for (const f of [() => { /x/.source = 1 }, () => { new Uint8Array(1).length = 3 }, () => { new URLSearchParams().size = 3 }, () => { new TextDecoder().encoding = "x" }, () => { /x/.lastIndex = 2; return 1 }]) { try { r.push(f()) } catch (e) { r.push(e.message) } }
for (const f of [() => { new Map().size = 1 }, () => { new Set().size = 1 }]) { try { r.push(f()) } catch (e) { r.push(e.message) } }
return r
