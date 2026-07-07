import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      complexity: ["error", 8],
      "max-depth": ["error", 3],
    },
  },
  {
    ignores: ["dist/", "node_modules/"],
  },
);
