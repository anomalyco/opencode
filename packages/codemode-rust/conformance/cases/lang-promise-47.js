const settled = await Promise.allSettled([tools.host.fail({}), tools.host.fail({})])
return settled.filter((s) => s.status === "rejected").length
