const p = tools.host.fail({})
try {
  await p
  return "no"
} catch (e) {
  return e.message
}
