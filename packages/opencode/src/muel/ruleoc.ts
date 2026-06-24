export type RuleocCheck = (output: { claim: string; evidenceSource: string }) => string | null

const NUM_RX = /^-?\d+(?:\.\d+)?$/

export function makeSumRule(label: string, getValues: () => Float64Array, getTotal: () => Float64Array): RuleocCheck {
  return () => {
    const items = getValues()
    const totalArr = getTotal()
    if (items.length === 0 || totalArr.length === 0) return null
    let sum = 0.0
    for (let i = 0; i < items.length; i++) sum += items[i]
    const total = totalArr[0]
    if (Math.abs(sum - total) > 0.01)
      return `${label}: sum(${sum.toFixed(2)}) ≠ total(${total.toFixed(2)})`
    return null
  }
}

export function makeRangeRule(label: string, getValue: () => Float64Array, min: number, max: number): RuleocCheck {
  return () => {
    const val = getValue()
    if (val.length === 0) return null
    const v = val[0]
    if (v < min || v > max)
      return `${label}: value ${v.toFixed(2)} outside range [${min}, ${max}]`
    return null
  }
}

export function makeNonNegativeRule(label: string, getValue: () => Float64Array): RuleocCheck {
  return () => {
    const val = getValue()
    for (let i = 0; i < val.length; i++) {
      if (val[i] < 0)
        return `${label}[${i}]: negative value ${val[i].toFixed(2)}`
    }
    return null
  }
}

export interface RuleocConfig {
  rules: RuleocCheck[]
}

export function checkRules(output: { claim: string; evidenceSource: string }, config: RuleocConfig): string[] {
  const violations: string[] = []
  for (const rule of config.rules) {
    const msg = rule(output)
    if (msg !== null) violations.push(msg)
  }
  return violations
}
