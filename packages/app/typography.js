/** Keep fixed CSS typography and its surrounding controls on the same rem scale. */
export function typography() {
  return {
    postcssPlugin: "opencode-typography",
    OnceExit(root) {
      root.walkDecls((declaration) => {
        const geometry = /^(?:(?:min-|max-)?height|padding(?:-|$)|gap|row-gap|--spacing$)/.test(declaration.prop)
        const line = declaration.prop === "line-height" || /line-height/.test(declaration.prop)

        // Preserve quoted copy and resource URLs. Media queries keep their original breakpoints.
        declaration.value = declaration.value.replace(
          /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\([^)]*\)|(-?(?:\d*\.)?\d+)(px|rem)\b/g,
          (token, number, unit) => {
            if (number === undefined || Number(number) === 0) {
              return token
            }

            const value = unit === "px" ? `${Number(number) / 16}rem` : token
            if (geometry || line) {
              return `calc(${value} * var(--app-line-height-scale, 1))`
            }

            return value
          },
        )

        // Relative line boxes already follow the font, but still need the independent spacing preference.
        if (line && /^(?:\d*\.)?\d+(?:em|%)?$/.test(declaration.value) && parseFloat(declaration.value) > 1) {
          declaration.value = `calc(${declaration.value} * var(--app-line-height-scale, 1))`
        }
      })
    },
  }
}
