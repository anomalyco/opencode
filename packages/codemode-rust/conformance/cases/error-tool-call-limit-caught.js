// @limits {"max_tool_calls": 1}
const out = [await tools.echo({ id: 1 })]
try { await tools.echo({ id: 2 }) } catch (e) { out.push("caught") }
return out
