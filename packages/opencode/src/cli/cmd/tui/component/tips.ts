import { t } from "@/i18n"

export function getTips(): string[] {
  return Array.from({ length: 101 }, (_, i) => t(`tips.${i}`))
}

// For backward compatibility
export const TIPS = getTips()
