const launch = async () => {
  tools.host.pending({ id: 1 })
  Promise.all([tools.host.pending({ id: 2 })])
  return "returned"
}
return await launch()
