const { app } = require("electron")
const fail = (error) => {
  console.error(error)
  app.exit(1)
}
// Install error handlers before loading any production modules. Electron's
// default startup handler otherwise opens a native dialog on the user's desktop.
process.on("uncaughtException", fail)
process.on("unhandledRejection", fail)
try {
  require("./native.cjs")
} catch (error) {
  fail(error)
}
