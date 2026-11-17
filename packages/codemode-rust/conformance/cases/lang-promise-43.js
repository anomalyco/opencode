const failLater = async () => {
  await tools.host.pending({ id: 1 })
  throw new Error("later")
}
const aggregate = Promise.all([Promise.reject(new Error("first")), failLater()])
try {
  await aggregate
  return "no"
} catch (error) {
  return error.message
}
