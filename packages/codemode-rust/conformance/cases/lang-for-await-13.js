const terminal = {
  [Symbol.iterator]: () => terminal,
  next: () => ({ done: true, value: Promise.reject("terminal") }),
}
let terminalError
try {
  for await (const item of terminal) {}
} catch (error) {
  terminalError = error
}

const closing = {
  [Symbol.iterator]: () => closing,
  next: () => ({ done: false, value: 1 }),
  return: () => ({ done: true, value: Promise.reject("close") }),
}
let closeError
try {
  for await (const item of closing) break
} catch (error) {
  closeError = error
}
return [terminalError, closeError]
