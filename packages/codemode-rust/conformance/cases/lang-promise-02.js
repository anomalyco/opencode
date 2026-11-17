const fail = async () => { throw new Error("boom") }
const promise = fail()
try {
  await promise
  return "no"
} catch (error) {
  return error.message
}
