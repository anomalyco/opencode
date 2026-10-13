/** Scale typography without changing explicit control geometry or decorative lengths. */
export function typography() {
  return {
    postcssPlugin: "opencode-typography",
    OnceExit(root) {
      root.walkDecls((declaration) => {
        const line = declaration.prop === "line-height" || /^--(?:.*-)?line-height(?:-|$)/.test(declaration.prop)
        const font =
          declaration.prop === "font-size" ||
          /^--(?:.*-)?font-size(?:-|$)/.test(declaration.prop) ||
          /^--text-\w+(?:-\w+)*$/.test(declaration.prop)

        if (!line && !font) {
          return
        }

        // Preserve quoted copy and resource URLs. Media queries keep their original breakpoints.
        declaration.value = declaration.value.replace(
          /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\([^)]*\)|(-?(?:\d*\.)?\d+)(?:px|rem)\b/g,
          (token, number) => {
            if (number === undefined || Number(number) === 0) {
              return token
            }

            if (line) {
              return `calc(${token} * var(--app-font-size-scale, 1) * var(--app-line-height-scale, 1))`
            }

            return `calc(${token} * var(--app-font-size-scale, 1))`
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
