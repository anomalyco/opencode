export type FragmentRef = {
  messageID: string
  partID: string
}

type FragmentState = {
  text: string
  projected?: string
}

export type FragmentUpdate = FragmentRef & {
  key: string
  previous: string
  text: string
}

export type FragmentRestore =
  | { type: "append"; suffix: string }
  | { type: "covered" }
  | { type: "conflict" }

export function fragmentRef(messageID: string, kind: "text" | "reasoning", ordinal: number): FragmentRef {
  return { messageID, partID: `${kind}:${ordinal}` }
}

export function createFragmentReconciler() {
  const fragments = new Map<string, FragmentState>()
  const key = (fragment: FragmentRef) => `${fragment.messageID}\u0000${fragment.partID}`

  return {
    clear() {
      fragments.clear()
    },
    key,
    value(fragment: FragmentRef) {
      return fragments.get(key(fragment))?.text
    },
    project(fragment: FragmentRef, text: string, visible: boolean): FragmentUpdate {
      const id = key(fragment)
      const current = fragments.get(id)
      fragments.set(id, {
        text,
        projected: visible ? text : current?.projected,
      })
      return { ...fragment, key: id, previous: current?.text ?? "", text }
    },
    delta(fragment: FragmentRef, delta: string): FragmentUpdate | undefined {
      const id = key(fragment)
      const current = fragments.get(id)
      // Replay may start after an unseen prefix, so consume a covered chunk
      // from anywhere in the remaining projection rather than only its start.
      const covered = current?.projected?.indexOf(delta) ?? -1
      if (current?.projected && covered >= 0) {
        current.projected = current.projected.slice(covered + delta.length)
        return
      }
      const previous = current?.text ?? ""
      const text = previous + delta
      fragments.set(id, { text, projected: current?.projected })
      return { ...fragment, key: id, previous, text }
    },
    end(fragment: FragmentRef, text: string): FragmentUpdate {
      const id = key(fragment)
      const previous = fragments.get(id)?.text ?? ""
      fragments.set(id, { text })
      return { ...fragment, key: id, previous, text }
    },
    restore(fragment: FragmentRef, text: string): FragmentRestore {
      const id = key(fragment)
      const current = fragments.get(id)
      if (!current) {
        fragments.set(id, { text, projected: text })
        return { type: "append", suffix: text }
      }
      if (text.startsWith(current.text)) {
        const suffix = text.slice(current.text.length)
        fragments.set(id, { text, projected: text })
        return { type: "append", suffix }
      }
      if (current.text.startsWith(text)) return { type: "covered" }
      return { type: "conflict" }
    },
  }
}

export type FragmentReconciler = ReturnType<typeof createFragmentReconciler>
