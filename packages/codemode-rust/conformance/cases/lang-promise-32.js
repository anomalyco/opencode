const aggregate = Promise.all([tools.host.fail({})])
try {
  await aggregate
  return "no"
} catch (error) {
  return error.message
}
