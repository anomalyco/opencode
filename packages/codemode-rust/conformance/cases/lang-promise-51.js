try {
  await Promise.race([tools.host.fail({}), tools.host.pending({ id: 1 })])
  return "no"
} catch (e) {
  return e.message
}
