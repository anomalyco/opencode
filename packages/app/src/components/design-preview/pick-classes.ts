export function pickClasses(classes: string | undefined): string[] {
  if (!classes) return []
  const parts = classes
    .trim()
    .split(/\s+/)
    .map((c) => c.replace(/^(?:[^:]+:)+/, ""))
    .filter((c) => {
      if (!c || c.length < 3) return false
      if (/^(hover|focus|active|disabled|dark)$/.test(c)) return false
      if (
        /^(flex(?:-(?:1|auto|none|col|row|wrap))?|grid|block|inline(?:-block|-flex)?|hidden|contents|relative|absolute|fixed|sticky|container|group|peer|truncate)$/.test(
          c,
        )
      )
        return false
      if (/^(bg|text|border|ring|fill|stroke)-(transparent|current|inherit|white|black)$/.test(c)) return false
      if (/^(w|h|min-w|min-h|max-w|max-h)-(?:\d|px|full|auto|screen|min|max|fit|\[|\d+\/\d+)/.test(c)) return false
      if (/^(p|m)[trblxy]?-(?:\d+|px|auto|\[[^\]]+\])$/.test(c)) return false
      if (/^gap-(?:\d+|px|\[[^\]]+\])$/.test(c)) return false
      if (/^(text-(?:xs|sm|base|lg|xl|[2-9]xl|left|center|right)|font-(?:normal|medium|semibold|bold))$/.test(c))
        return false
      if (
        /^(rounded(?:-[a-z0-9]+)?|border(?:-[trblxy])?(?:-\d+)?|shadow(?:-[a-z]+)?|overflow-(?:hidden|auto|scroll|visible)|items-(?:start|center|end|stretch)|justify-(?:start|center|end|between|around|evenly)|cursor-(?:pointer|default|not-allowed)|opacity-(?:0|25|50|75|100)|transition(?:-[a-z-]+)?|duration-\d+|ease-(?:linear|in|out|in-out)|min-(?:w|h)-0|max-(?:w|h)-full|z-(?:\d+|auto)|(?:top|bottom|left|right|inset)-(?:0|px|full|auto|\[[^\]]+\])|whitespace-(?:nowrap|pre)|list-(?:none|disc|decimal)|pointer-events-(?:none|auto)|select-(?:none|text|all)|appearance-none|outline-none|ring-0|sr-only|not-sr-only)$/.test(
          c,
        )
      )
        return false
      if (
        /^(text|bg|border)-(gray|red|blue|green|yellow|purple|pink|indigo|orange|teal|cyan|emerald|violet|rose|lime|sky|amber|fuchsia|slate|zinc|neutral|stone)-\d+$/.test(
          c,
        )
      )
        return false
      return true
    })
  return parts.sort((a, b) => b.length - a.length).slice(0, 3)
}
