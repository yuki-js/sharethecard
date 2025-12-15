
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import pluginImport from "eslint-plugin-import";
import pluginN from "eslint-plugin-n";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
        ecmaVersion: "latest",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      import: pluginImport,
      n: pluginN,
    },
    settings: {
      "import/resolver": {
        node: { extensions: [".js", ".ts"] },
      },
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
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
  },
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
  {
    files: ["packages/shared/src/utils/logger.ts"],
    rules: {
      "no-console": "off",
    },
  },
  eslintConfigPrettier,
];
