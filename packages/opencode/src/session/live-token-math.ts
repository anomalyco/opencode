/**
 * v114-format token and cost display helpers.
 *
 * Formats numbers for live token tracking UI matching Claude Code v2.1.114
 * output format (uu$ at line 203208).
 */

/**
 * Formats a token count with thousands separators.
 * Example: 208258 → "208,258"
 */
export function formatTokenNumber(n: number): string {
    return new Intl.NumberFormat("en-US").format(n);
}

/**
 * Formats a USD cost with currency symbol and 2 decimal places.
 * Example: 0.1234567 → "$0.12"
 */
export function formatCost(usd: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(usd);
}

/**
 * Formats a per-model usage line matching v114 uu$ format.
 * Example: formatModelLine("claude-opus-4-7", 1234, 567, 89, 12, 0.05)
 * → "  claude-opus-4-7: 1,234 input, 567 output, 89 cache read, 12 cache write ($0.05)"
 */
export function formatModelLine(
    model: string,
    input: number,
    output: number,
    cacheRead: number,
    cacheWrite: number,
    cost: number,
): string {
    return `  ${model}: ${formatTokenNumber(input)} input, ${formatTokenNumber(output)} output, ${formatTokenNumber(cacheRead)} cache read, ${formatTokenNumber(cacheWrite)} cache write (${formatCost(cost)})`;
}
