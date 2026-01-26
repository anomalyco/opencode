import { useState } from "react"
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"

interface QuestionOption {
  label: string
  description: string
}

interface Question {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

interface Props {
  request: {
    id: string
    questions: Question[]
  }
  isDark: boolean
  onReply: (answers: string[][]) => void
  onReject: () => void
}

export function QuestionPrompt({ request, isDark, onReply, onReject }: Props) {
  const [answers, setAnswers] = useState<string[][]>(request.questions.map(() => []))
  const [custom, setCustom] = useState("")
  const [showCustom, setShowCustom] = useState(false)
  const [current, setCurrent] = useState(0)

  const q = request.questions[current]
  if (!q) return null

  const toggleOption = (label: string) => {
    setAnswers((prev) => {
      const copy = [...prev]
      const selected = copy[current] || []
      if (q.multiple) {
        copy[current] = selected.includes(label) ? selected.filter((a) => a !== label) : [...selected, label]
      } else {
        copy[current] = [label]
        if (request.questions.length === 1) {
          setTimeout(() => onReply(copy), 100)
        }
      }
      return copy
    })
  }

  const submitCustom = () => {
    if (!custom.trim()) return
    const copy = [...answers]
    copy[current] = [custom.trim()]
    setAnswers(copy)
    setCustom("")
    setShowCustom(false)
    if (request.questions.length === 1) {
      onReply(copy)
    }
  }

  return (
    <View style={[s.card, isDark && s.cardDark]}>
      <View style={s.header}>
        <Ionicons name="chatbubble-ellipses-outline" size={18} color="#8b5cf6" />
        <Text style={[s.title, isDark && s.textWhite]}>{q.header || "Question"}</Text>
      </View>
      <Text style={[s.question, isDark && s.textWhite]}>{q.question}</Text>

      <View style={s.options}>
        {q.options.map((opt) => {
          const selected = (answers[current] || []).includes(opt.label)
          return (
            <TouchableOpacity
              key={opt.label}
              style={[
                s.option,
                isDark && s.optionDark,
                selected && s.optionSelected,
                selected && isDark && s.optionSelectedDark,
              ]}
              onPress={() => toggleOption(opt.label)}
            >
              <Text style={[s.optionLabel, isDark && s.textWhite, selected && s.optionLabelSelected]}>{opt.label}</Text>
              {opt.description ? <Text style={[s.optionDesc, isDark && s.metaDark]}>{opt.description}</Text> : null}
            </TouchableOpacity>
          )
        })}

        {q.custom !== false &&
          (showCustom ? (
            <View style={s.customRow}>
              <TextInput
                style={[s.customInput, isDark && s.customInputDark]}
                placeholder="Type your answer..."
                placeholderTextColor={isDark ? "#666666" : "#999999"}
                value={custom}
                onChangeText={setCustom}
                onSubmitEditing={submitCustom}
                autoFocus
              />
              <TouchableOpacity onPress={submitCustom} style={s.customSubmit}>
                <Ionicons name="send" size={18} color="#8b5cf6" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={[s.option, isDark && s.optionDark]} onPress={() => setShowCustom(true)}>
              <Text style={[s.optionLabel, { color: "#8b5cf6" }]}>Type your own answer</Text>
            </TouchableOpacity>
          ))}
      </View>

      <View style={s.footer}>
        <TouchableOpacity onPress={onReject}>
          <Text style={[s.dismiss, isDark && s.metaDark]}>Dismiss</Text>
        </TouchableOpacity>
        {(request.questions.length > 1 || q.multiple) && (
          <TouchableOpacity
            style={[s.submitBtn, isDark && s.submitBtnDark]}
            onPress={() => {
              if (current < request.questions.length - 1) {
                setCurrent(current + 1)
              } else {
                onReply(answers)
              }
            }}
          >
            <Text style={s.submitText}>{current < request.questions.length - 1 ? "Next" : "Submit"}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  card: {
    margin: 12,
    padding: 16,
    backgroundColor: "#f5f3ff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ede9fe",
  },
  cardDark: { backgroundColor: "#1a1a2e", borderColor: "#2a2a3e" },
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  title: { fontSize: 15, fontWeight: "600", color: "#6d28d9" },
  textWhite: { color: "#ffffff" },
  question: { fontSize: 14, lineHeight: 20, color: "#0a0a0a", marginBottom: 12 },
  metaDark: { color: "#666666" },

  options: { gap: 8 },
  option: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  optionDark: { backgroundColor: "#2a2a2a", borderColor: "#3a3a3a" },
  optionSelected: { borderColor: "#8b5cf6", backgroundColor: "#f5f3ff" },
  optionSelectedDark: { borderColor: "#8b5cf6", backgroundColor: "#2a1a3e" },
  optionLabel: { fontSize: 14, fontWeight: "600", color: "#0a0a0a" },
  optionLabelSelected: { color: "#6d28d9" },
  optionDesc: { fontSize: 12, color: "#666666", marginTop: 2 },

  customRow: { flexDirection: "row", gap: 8 },
  customInput: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    color: "#0a0a0a",
  },
  customInputDark: { backgroundColor: "#2a2a2a", borderColor: "#3a3a3a", color: "#ffffff" },
  customSubmit: { justifyContent: "center", alignItems: "center", padding: 8 },

  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 },
  dismiss: { fontSize: 14, color: "#999999" },
  submitBtn: { backgroundColor: "#8b5cf6", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  submitBtnDark: { backgroundColor: "#7c3aed" },
  submitText: { color: "#ffffff", fontWeight: "600", fontSize: 14 },
})
