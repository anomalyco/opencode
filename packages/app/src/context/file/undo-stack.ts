// [fork-only] 文件树操作撤销栈(commit #4 of file-tree-dnd)
//
// 容量 20,FIFO(超过弹出最旧)。in-memory,刷新即丢(v1)。
//
// entry 类型:
//   - move: 反向 = 把 to 重命名回 from(逐对反向 rename)
//   - copy: 反向 = 把 created 文件 trash(已存在副本不会被恢复)
//
// pop 时调用 reverter(注入,因为 store 内不直接依赖 Tauri)。

const CAPACITY = 20

type MoveEntry = {
  kind: "move"
  pairs: ReadonlyArray<{ from: string; to: string }>
}

type CopyEntry = {
  kind: "copy"
  created: ReadonlyArray<string>
}

export type UndoEntry = MoveEntry | CopyEntry

export type UndoReverter = {
  /** 反向 move:把 to 重命名回 from */
  reverseMove: (pairs: ReadonlyArray<{ from: string; to: string }>) => Promise<{ refreshAbs: ReadonlyArray<string> }>
  /** 反向 copy:把 created 文件 trash */
  reverseCopy: (created: ReadonlyArray<string>) => Promise<{ refreshAbs: ReadonlyArray<string> }>
}

export function createUndoStack() {
  const stack: UndoEntry[] = []

  const push = (entry: UndoEntry): void => {
    stack.push(entry)
    if (stack.length > CAPACITY) stack.shift() // 弹出最旧
  }

  const pop = async (reverter: UndoReverter): Promise<{ refreshAbs: ReadonlyArray<string> } | null> => {
    const entry = stack.pop()
    if (!entry) return null
    if (entry.kind === "move") return reverter.reverseMove(entry.pairs)
    return reverter.reverseCopy(entry.created)
  }

  const clear = (): void => {
    stack.length = 0
  }

  const size = (): number => stack.length

  return { push, pop, clear, size }
}

export type UndoStack = ReturnType<typeof createUndoStack>
