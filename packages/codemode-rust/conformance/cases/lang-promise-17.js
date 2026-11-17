const run = async () => {
  await tools.host.pending({ id: 1 })
  tools.host.fail({})
}
run()
return "done"
