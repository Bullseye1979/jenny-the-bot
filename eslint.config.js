import noForeignConfig from "./eslint-rules/no-foreign-config.js";

export default [
  {
    files: ["modules/**/*.js"],
    plugins: {
      local: {
        rules: {
          "no-foreign-config": noForeignConfig,
        },
      },
    },
    rules: {
      "local/no-foreign-config": "error",
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
];
