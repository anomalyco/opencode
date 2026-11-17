const messages = []
for (const call of [() => tools.ech({ id: 1 }), () => tools.git.stat({}), () => tools.git({}), () => tools.nothing.here({})]) {
  try { await call() } catch (e) { messages.push(e.message) }
}
return messages
