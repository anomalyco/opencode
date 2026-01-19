import { dict as en } from "./en"

type Keys = keyof typeof en

export const dict = {
  "command.category.language": "\u8bed\u8a00",
  "command.language.cycle": "\u5207\u6362\u8bed\u8a00",
  "command.language.set": "\u4f7f\u7528\u8bed\u8a00: {{language}}",
  "language.en": "\u82f1\u8bed",
  "language.zh": "\u4e2d\u6587",
  "toast.language.title": "\u8bed\u8a00",
  "toast.language.description": "\u5df2\u5207\u6362\u5230{{language}}",
} satisfies Partial<Record<Keys, string>>
