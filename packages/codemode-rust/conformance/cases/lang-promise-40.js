try {
  await Promise.all([tools.host.echo({ id: 1 }), tools.host.fail({})])
  return "no"
} catch (e) {
  return e.message
}
