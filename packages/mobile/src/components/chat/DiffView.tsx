import { View, Text, StyleSheet, Platform } from "react-native"

const mono = Platform.OS === "ios" ? "Menlo" : "monospace"

interface Props {
  before: string
  after: string
  isDark: boolean
}

interface DiffLine {
  type: "add" | "remove" | "context"
  text: string
}

function computeDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n")
  const b = after.split("\n")
  const lines: DiffLine[] = []

  // Simple LCS-based diff
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // Backtrack
  const result: DiffLine[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.push({ type: "context", text: a[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: "add", text: b[j - 1] })
      j--
    } else {
      result.push({ type: "remove", text: a[i - 1] })
      i--
    }
  }

  result.reverse()

  // Collapse long context runs (show max 3 context lines between changes)
  const collapsed: DiffLine[] = []
  let contextRun = 0
  for (const line of result) {
    if (line.type === "context") {
      contextRun++
      if (contextRun <= 3) {
        collapsed.push(line)
      } else if (contextRun === 4) {
        collapsed.push({ type: "context", text: "..." })
      }
    } else {
      contextRun = 0
      collapsed.push(line)
    }
  }

  return collapsed
}

export function DiffView({ before, after, isDark }: Props) {
  const lines = computeDiff(before, after)

  if (lines.length === 0) return null

  return (
    <View style={[s.container, isDark && s.containerDark]}>
      {lines.map((line, idx) => (
        <View
          key={idx}
          style={[
            s.line,
            line.type === "add" && (isDark ? s.addDark : s.add),
            line.type === "remove" && (isDark ? s.removeDark : s.remove),
          ]}
        >
          <Text style={[s.prefix, isDark && s.prefixDark]}>
            {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
          </Text>
          <Text
            style={[
              s.text,
              isDark && s.textDark,
              line.type === "add" && s.addText,
              line.type === "remove" && s.removeText,
            ]}
            selectable
            numberOfLines={1}
          >
            {line.text}
          </Text>
        </View>
      ))}
    </View>
  )
}

const s = StyleSheet.create({
  container: {
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: "#f8f8f8",
    marginTop: 6,
  },
  containerDark: { backgroundColor: "#1a1a1a" },

  line: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  add: { backgroundColor: "#dcfce7" },
  addDark: { backgroundColor: "#052e16" },
  remove: { backgroundColor: "#fee2e2" },
  removeDark: { backgroundColor: "#2a0a0a" },

  prefix: {
    width: 16,
    fontSize: 12,
    fontFamily: mono,
    color: "#999999",
    lineHeight: 20,
  },
  prefixDark: { color: "#666666" },

  text: {
    flex: 1,
    fontSize: 12,
    fontFamily: mono,
    color: "#0a0a0a",
    lineHeight: 20,
  },
  textDark: { color: "#e5e5e5" },
  addText: { color: "#16a34a" },
  removeText: { color: "#dc2626" },
})
