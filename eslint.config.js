import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["out/**", "dist/**", "release/**", "node_modules/**", "coverage/**", "examples/**"],
  },

  // Base JS recommended
  js.configs.recommended,

  // TypeScript recommended (type-checked)
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Project-wide language options
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js", "electron.vite.config.ts", "vitest.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Main process and shared: Node globals
  {
    files: ["src/main/**/*.{ts,tsx}", "src/preload/**/*.{ts,tsx}", "src/shared/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Renderer: browser globals + React
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
  },

  // Project conventions enforced for application code
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
      curly: ["error", "all"],
    },
  },

  // Test files: relax a few rules
  {
    files: ["src/**/*.{test,spec}.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Prettier last (among style rules) to disable conflicting rules
  prettier,

  // Root-level config files: disable type-checked rules entirely.
  // These files use a default project without full type information,
  // so type-aware rules cannot run on them. This block MUST come last
  // (flat config: last-wins) so it overrides earlier rule definitions.
  {
    files: ["eslint.config.js", "electron.vite.config.ts", "vitest.config.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
