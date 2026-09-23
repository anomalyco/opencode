export function isPeakPricing(date: Date) {
  // DeepSeek peak pricing in China Standard Time (UTC+8):
  // - Weekdays only
  // - 9 AM to noon
  // - 2 PM to 6 PM
  const dateCN = new Date(date.getTime() + 8 * 3_600 * 1000)
  const dayCN = dateCN.getUTCDay()
  if (dayCN === 0 || dayCN === 6) return false
  const hourCN = dateCN.getUTCHours()
  return (hourCN >= 9 && hourCN < 12) || (hourCN >= 14 && hourCN < 18)
}
