export function frame() {
  return new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(finish)
    }
    setTimeout(finish, 50)
  })
}

export async function settled(done?: Promise<unknown>) {
  if (done) await done
  await frame()
}

export function raf(fn: () => void) {
  let id = 0
  return {
    run: () => {
      if (id) return
      id = requestAnimationFrame(() => {
        id = 0
        fn()
      })
    },
    stop: () => {
      if (!id) return
      cancelAnimationFrame(id)
      id = 0
    },
  }
}
