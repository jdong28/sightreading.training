const js = require("@eslint/js")
const globals = require("globals")

module.exports = [
  {
    ...js.configs.recommended,
    files: ["**/*.js", "**/*.jsx"]
  },
  // the offline Claude command (tools/claude-flags): node modules, beside
  // the browser modules of its bridge, which the block below lints as the app
  {
    ...js.configs.recommended,
    files: ["tools/claude-flags/**/*.mjs"],
  },
  {
    files: ["tools/claude-flags/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node
      }
    },
    rules: {
      "no-unused-vars": "off",
      "no-empty": "off",
      "no-useless-assignment": "off",
      "linebreak-style": ["error", "unix"],
      "quotes": ["error", "double", { avoidEscape: true }]
    }
  },
  {
    files: ["**/*.js", "**/*.jsx"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        ...globals.browser,
        ...globals.jasmine
      }
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": "off",
      "no-empty": "off",
      "no-useless-assignment": "off",
      "no-constant-condition": ["error", { checkLoops: false }],
      "linebreak-style": ["error", "unix"],
      "quotes": ["error", "double", { avoidEscape: true }]
    }
  }
]
