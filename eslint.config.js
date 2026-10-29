import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.next-e2e/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "packages/contracts/generated/**",
      "**/next-env.d.ts",
      "packages/contracts/lib/**",
      "packages/contracts/out/**",
      "packages/circuits/build/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["scripts/**/*.mjs", "packages/*/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
);
