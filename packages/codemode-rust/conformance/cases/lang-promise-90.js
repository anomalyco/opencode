let innerResolve, innerReject
const adopted = new Promise((resolve) => resolve(new Promise((resolve) => { innerResolve = resolve })))
const adoptedRejection = new Promise((resolve) => resolve(new Promise((_, reject) => { innerReject = reject })))
innerResolve("later")
innerReject("bad")
try {
  return [await adopted, await adoptedRejection]
} catch (reason) {
  return [await adopted, reason]
}
