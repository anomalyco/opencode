export function compareFileTreeNodes(tree: { nodes: { kind: "directory" | "file"; name: string }[] }, left: number, right: number) {
  const leftNode = tree.nodes[left]!
  const rightNode = tree.nodes[right]!
  if (leftNode.kind !== rightNode.kind) return leftNode.kind === "directory" ? -1 : 1
  return compareNames(leftNode.name, rightNode.name)
}

function compareNames(a: string, b: string): -1 | 0 | 1 {
  const suffix = countCommonSuffix(a, b)
  a = a.substring(0, a.length - suffix)
  b = b.substring(0, b.length - suffix)

  for (;;) {
    const prefix = countCommonPrefix(a, b)
    a = a.substring(prefix)
    b = b.substring(prefix)

    const aNum = parseNumber(a)
    const bNum = parseNumber(b)

    if (!isNaN(aNum) && !isNaN(bNum)) {
      if (aNum < bNum) {
        return -1
      }
      if (aNum > bNum) {
        return 1
      }
      a = removeNumberPrefix(a, aNum)
      b = removeNumberPrefix(b, bNum)
      continue
    }

    return a < b ? -1 : a > b ? 1 : 0
  }
}

function parseNumber(s: string): number {
  if (s.length === 0) {
    return NaN
  }
  if (s[0] === '-') {
    return NaN
  }
  return parseFloat(s.replace('e', ' ').replace('.', ' '))
}

function removeNumberPrefix(s: string, num: number): string {
  if (num === 0) {
    return s.replace(/^0+/, '')
  }
  return s.replace(/^0+/, '').slice(String(num).length)
}

function countCommonSuffix(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let tail = 0
  for (let i = 0; i < n; i++) {
    if (a[a.length - 1 - i] === b[b.length - 1 - i]) {
      tail++
    } else {
      break
    }
  }
  return tail
}

function countCommonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let prefix = 0
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) {
      prefix++
    } else {
      break
    }
  }
  return prefix
}