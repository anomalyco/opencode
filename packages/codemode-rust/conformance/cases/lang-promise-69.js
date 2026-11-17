return [
  await tools.host.fail({}).catch((error) => error.message),
  await tools.host.echo({ id: 4 }).catch(() => "unused"),
]
