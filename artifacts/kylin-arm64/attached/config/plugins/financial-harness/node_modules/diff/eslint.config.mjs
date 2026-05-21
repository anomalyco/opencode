// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/*", // ignore everything...
      "!src/**/", "!src/**/*.ts", // ... except our TypeScript source files...
      "!test/**/", "!test/**/*.js", // ... and our tests
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    extends: [tseslint.configs.recommendedTypeChecked],
    rules: {
      // Not sure if these actually serve a purpose, but they provide a way to enforce SOME of what
      // would be imposed by having "verbatimModuleSyntax": true in our tsconfig.json without
      // actually doing that.
      "@typescript-eslint/consistent-type-imports": 2,
      "@typescript-eslint/consistent-type-exports": 2,

      // Things from the recommendedTypeChecked shared config that are disabled simply because they
      // caused lots of errors in our existing code when tried. Plausibly useful to turn on if
      // possible and somebody fancies doing the work:
      "@typescript-eslint/no-unsafe-argument": 0,
      "@typescript-eslint/no-unsafe-assignment": 0,
      "@typescript-eslint/no-unsafe-call": 0,
      "@typescript-eslint/no-unsafe-member-access": 0,
      "@typescript-eslint/no-unsafe-return": 0,
    }
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },

    rules: {
      // Possible Errors //
      //-----------------//
      "comma-dangle": [2, "never"],
      "no-console": 1, // Allow for debugging
      "no-debugger": 1, // Allow for debugging
      "no-extra-parens": [2, "functions"],
      "no-extra-semi": 2,
      "no-negated-in-lhs": 2,
      "no-unreachable": 1, // Optimizer and coverage will handle/highlight this and can be useful for debugging

      // Best Practices //
      //----------------//
      curly: 2,
      "default-case": 1,
      "dot-notation": [2, {
        allowKeywords: false,
      }],
      "guard-for-in": 1,
      "no-alert": 2,
      "no-caller": 2,
      "no-div-regex": 1,
      "no-eval": 2,
      "no-extend-native": 2,
      "no-extra-bind": 2,
      "no-floating-decimal": 2,
      "no-implied-eval": 2,
      "no-iterator": 2,
      "no-labels": 2,
      "no-lone-blocks": 2,
      "no-multi-spaces": 2,
      "no-multi-str": 1,
      "no-native-reassign": 2,
      "no-new": 2,
      "no-new-func": 2,
      "no-new-wrappers": 2,
      "no-octal-escape": 2,
      "no-process-env": 2,
      "no-proto": 2,
      "no-return-assign": 2,
      "no-script-url": 2,
      "no-self-compare": 2,
      "no-sequences": 2,
      "no-throw-literal": 2,
      "no-unused-expressions": 2,
      "no-warning-comments": 1,
      radix: 2,
      "wrap-iife": 2,

      // Variables //
      //-----------//
      "no-catch-shadow": 2,
      "no-label-var": 2,
      "no-undef-init": 2,

      // Node.js //
      //---------//

      // Stylistic //
      //-----------//
      "brace-style": [2, "1tbs", {
        allowSingleLine: true,
      }],
      camelcase: 2,
      "comma-spacing": [2, {
        before: false,
        after: true,
      }],
      "comma-style": [2, "last"],
      "consistent-this": [1, "self"],
      "eol-last": 2,
      "func-style": [2, "declaration"],
      "key-spacing": [2, {
        beforeColon: false,
        afterColon: true,
      }],
      "new-cap": 2,
      "new-parens": 2,
      "no-array-constructor": 2,
      "no-lonely-if": 2,
      "no-mixed-spaces-and-tabs": 2,
      "no-nested-ternary": 1,
      "no-new-object": 2,
      "no-spaced-func": 2,
      "no-trailing-spaces": 2,
      "quote-props": [2, "as-needed", {
        keywords: true,
      }],
      quotes: [2, "single", "avoid-escape"],
      semi: 2,
      "semi-spacing": [2, {
        before: false,
        after: true,
      }],
      "space-before-blocks": [2, "always"],
      "space-before-function-paren": [2, {
        anonymous: "never",
        named: "never",
      }],
      "space-in-parens": [2, "never"],
      "space-infix-ops": 2,
      "space-unary-ops": 2,
      "spaced-comment": [2, "always"],
      "wrap-regex": 1,
      "no-var": 2,

      // Typescript //
      //------------//
      "@typescript-eslint/no-explicit-any": 0, // Very strict rule, incompatible with our code

      // We use these intentionally - e.g.
      //     export interface DiffCssOptions extends CommonDiffOptions {}
      // for the options argument to diffCss which currently takes no options beyond the ones
      // common to all diffFoo functions. Doing this allows consistency (one options interface per
      // diffFoo function) and future-proofs against the API having to change in future if we add a
      // non-common option to one of these functions.
      "@typescript-eslint/no-empty-object-type": [2, {allowInterfaces: 'with-single-extends'}],
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.mocha,
      },
    },
    rules: {
      "no-unused-expressions": 0, // Needs disabling to support Chai `.to.be.undefined` etc syntax
      "@typescript-eslint/no-unused-expressions": 0, // (as above)
    },
  }
);
