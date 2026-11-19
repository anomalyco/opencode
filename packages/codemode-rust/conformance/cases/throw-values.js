const out = []
for (const v of ["str", 42, { code: 7 }, null]) { try { throw v } catch (e) { out.push(e) } }
return out
