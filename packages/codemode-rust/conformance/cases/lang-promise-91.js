const result = new Promise(async (resolve) => {
  const id = await tools.host.echo({ id: 5 })
  resolve(id * 2)
})
return await result
