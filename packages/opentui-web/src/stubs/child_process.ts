// Browser stub for node:child_process
export const spawn = () => {
  throw new Error("child_process.spawn is not available in browser")
}

export const exec = () => {
  throw new Error("child_process.exec is not available in browser")
}

export const execSync = () => {
  throw new Error("child_process.execSync is not available in browser")
}

export default {
  spawn,
  exec,
  execSync,
}
