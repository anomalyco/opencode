const pending = tools.host.pending({ id: 9 })
const winner = await Promise.race([Promise.all([Promise.resolve(1)]), Promise.resolve(2)])
try {
  const raced = await Promise.race([Promise.all([Promise.reject("x"), pending]), Promise.resolve("ok")])
  return [winner, "fulfilled", raced]
} catch (reason) {
  return [winner, "rejected", reason]
}
