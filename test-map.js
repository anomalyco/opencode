const ramp = (base, weak, strong, border, text) => {
  return {
    50: weak,
    100: base,
    200: base,
    300: border,
    400: text,
    500: strong,
    600: strong,
    700: text,
    800: text,
    900: text
  }
}
console.log(ramp("base", "weak", "strong", "border", "text"))
