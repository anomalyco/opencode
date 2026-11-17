const settled = await Promise.allSettled([
  tools.host.echo({ id: 5 }),
  tools.host.fail({}),
  "plain",
  Promise.reject(new Error("boom")),
])
return settled
