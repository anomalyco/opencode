const multicortex = [
  "████▄  ██████ ██  ██ ▄█████ ▄████▄ █████▄  ██████",
  "██  ██ ██▄▄   ██▄▄██ ██     ██  ██ ██▄▄██▄ ██▄▄",
  "████▀  ██▄▄▄▄  ▀██▀  ▀█████ ▀████▀ ██   ██ ██▄▄▄▄",
]

const width = Math.max(...multicortex.map((line) => line.length))
const split = Math.floor(width / 2)

export const logo = {
  left: multicortex.map((line) => line.padEnd(width).slice(0, split)),
  right: multicortex.map((line) => line.padEnd(width).slice(split)),
}

export const go = {
  left: [" ", "█▀▄▀█", "█ ▀ █", "▀   ▀"],
  right: [" ", "█▀▀", "█▄▄", "▀▀▀"],
}

export const marks = "_^~,"
