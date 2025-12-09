/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    sourceType: "module",
    ecmaVersion: "latest",
  },
  plugins: ["@typescript-eslint", "import", "n"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:import/recommended",
    "plugin:n/recommended",
    "prettier",
  ],
  settings: {
    "import/resolver": {
      node: { extensions: [".js", ".ts"] },
    },
  },
  rules: {
    "no-console": ["error", { allow: ["info", "warn", "error"] }],
    curly: ["error", "all"],
    eqeqeq: ["error", "always"],
    "import/order": [
      "error",
      {
        "newlines-between": "always",
        alphabetize: { order: "asc", caseInsensitive: true },
      },
    ],
    "n/no-missing-import": "off",
    "@typescript-eslint/consistent-type-imports": "error",
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-non-null-assertion": "warn",
  },
  overrides: [
    {
      files: ["**/*.test.ts", "tests/**/*.ts"],
      rules: {
        "no-console": "error",
      },
    },
    {
      files: ["packages/router/**/*.ts"],
      rules: {
        "n/no-unsupported-features/es-syntax": "off",
      },
    },
  ],
};
