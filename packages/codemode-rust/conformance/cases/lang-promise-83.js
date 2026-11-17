try {
  await Promise.any([tools.host.fail({}), Promise.reject("plain")])
  return "fulfilled"
} catch (error) {
  return [error.name, error.errors.map((reason) => reason.message ?? reason)]
}
