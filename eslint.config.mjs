import tseslint from "@typescript-eslint/eslint-plugin"
import tsParser from "@typescript-eslint/parser"
import functional from "eslint-plugin-functional"
import importPlugin from "eslint-plugin-import"
import promise from "eslint-plugin-promise"
import sonarjs from "eslint-plugin-sonarjs"
import ava from "eslint-plugin-ava"

export default [
  {
    ignores: [
      "**/dist/**",
      "**/.cache/**",
      "./scripts/**",
      "./templates/**",
      "./eslint.config.ts",
      "**/pseudo/**",
      "packages/smartgpt-bridge/src/fixtures",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true, // uses your tsconfig.* automatically
        allowDefaultProject: true,
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      functional,
      import: importPlugin,
      sonarjs,
      promise,
      ava,
    },
    rules: {
      "sonarjs/cognitive-complexity": ["error", 15],
      "sonarjs/no-collapsible-if": "warn",
      "sonarjs/no-inverted-boolean-check": "warn",
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 50, IIFEs: true }],
      "max-params": ["error", 4],
      complexity: ["error", 15],
      // TypeScript strictness (lint-side)
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",

      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/prefer-readonly-parameter-types": [
        "warn",
        {
          // these avoid most transient-symbol pitfalls
          ignoreInferredTypes: true,
          checkParameterProperties: false,
          // optional: if DOM/3rd-party types cause noise, allow them:
          // allow: [{ from: "lib", name: ["HTMLElement", "Event"] }]
        },
      ],
      "no-var": "error",
      "prefer-const": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='require']",
          message: "ESM only",
        },
        {
          selector: "MemberExpression[object.name='module'][property.name='exports']",
          message: "ESM only",
        },
        {
          selector: "ClassDeclaration",
          message: "Class declarations are not allowed.",
        },
        {
          selector: "ClassExpression",
          message: "Class expressions are not allowed.",
        },
      ],
      // FP: immutability & purity
      "functional/no-let": "error",
      "functional/no-try-statements": "warn", // flip to "warn" if you want
      "functional/prefer-immutable-types": [
        "warn",
        {
          enforcement: "ReadonlyDeep",
          ignoreInferredTypes: true, // avoids noise on inferred literals
        },
      ],
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "functional/immutable-data": ["warn", { ignoreClasses: "fieldsOnly" }],
      "functional/no-loop-statements": "warn",
      "functional/no-method-signature": "off", // keep TS ergonomics
      "functional/prefer-tacit": "off", // readability first

      // Side-effect control
      "promise/no-return-wrap": "warn",
      "promise/param-names": "warn",

      // Imports hygiene
      "import/first": "warn",
      "import/no-default-export": "warn",
      "import/no-cycle": ["warn", { maxDepth: 1 }],
      "import/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index", "object"],
          "newlines-between": "always",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@promethean/persistence",
              importNames: ["ContextStore"],
              message: "Use makeContextStore (functional) instead of class ContextStore.",
            },
            {
              name: "@promethean/agents/agent-context",
              importNames: ["DefaultContextManager", "ContextManager"],
              message:
                "This is agent state, not LLM conversation. Import makeAgentStateManager (or LegacyAgentStateManager alias) instead.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/markdown/src/**/*.ts"],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      complexity: "off",
      "max-params": "off",
      "functional/no-let": "off",
      "functional/no-try-statements": "off",
      "functional/prefer-immutable-types": "off",
      "functional/immutable-data": "off",
      "functional/no-loop-statements": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/prefer-readonly-parameter-types": "off",
      "import/order": "off",
    },
  },
  {
    files: ["**/src/scripts/**/*.ts"],
    rules: {
      // Loosen function length for script utilities
      "max-lines-per-function": ["warn", { max: 100, IIFEs: true }],
    },
  },
  {
    files: ["**/*.test.{ts,tsx,js}", "**/*.spec.{ts,tsx,js}", "**/tests/**/*.{ts,tsx,js}"],
    plugins: { ava },
    rules: {
      "ava/no-only-test": "error",
      "ava/no-identical-title": "error",
      "ava/test-title": "warn",
      // your existing no-restricted-syntax for setTimeout
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='setTimeout'][arguments.0.type='Identifier']",
          message: "Use sleep from @promethean/test-utils instead of setTimeout for sleeps in tests.",
        },
      ],
    },
  },
  {
    files: ["packages/compiler/**/*.{ts,tsx,js}"],
    rules: {
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/prefer-readonly-parameter-types": "off",
      "@typescript-eslint/switch-exhaustiveness-check": "off",
      complexity: "off",
      "max-lines-per-function": "off",
      "sonarjs/cognitive-complexity": "off",
      "functional/no-let": "off",
      "functional/no-loop-statements": "off",
      "functional/immutable-data": "off",
      "functional/prefer-immutable-types": "off",
    },
  },
]
