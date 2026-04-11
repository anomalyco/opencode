// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config")
const tsGuard = require("@typescript-eslint/eslint-plugin")
const expoConfig = require("eslint-config-expo/flat")
const reactHooksNext = require("eslint-plugin-react-hooks")

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      "react-hooks-next": reactHooksNext,
      "ts-guard": tsGuard,
    },
    rules: {
      "ts-guard/no-explicit-any": "warn",
      "ts-guard/no-floating-promises": "warn",
      complexity: ["warn", 20],
      "max-lines": [
        "warn",
        {
          max: 1200,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      "max-lines-per-function": [
        "warn",
        {
          max: 250,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-nested-ternary": "warn",
      "react-hooks/exhaustive-deps": "error",
      "react-hooks-next/refs": "warn",
      "react-hooks-next/set-state-in-effect": "warn",
      "react-hooks-next/static-components": "warn",
    },
  },
])
