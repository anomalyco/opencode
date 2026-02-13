export function socketCloseIsError(code: number) {
  return code !== 1000
}

export function sigwinchToggleSize(cols: number, rows: number) {
  const safeCols = Math.max(2, cols)
  return [
    { cols: Math.max(2, safeCols - 1), rows },
    { cols: safeCols, rows },
  ]
}

export function restoreThenLive(restore: string, live: string[]) {
  return `${restore}${live.join("")}`
}
