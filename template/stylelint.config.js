export default {
  extends: ["stylelint-config-standard"],
  ignoreFiles: [
    ".claude/**",
    "**/node_modules/**",
    "**/gen/**",
    "**/dist/**",
    "**/.cache/**",
    "**/.spec-cache/**",
    "**/.alchemy/**",
    "**/.wrangler/**",
    "**/generated/**",
    "**/storybook-static/**",
  ],
  rules: {
    "at-rule-no-unknown": [true, { ignoreAtRules: ["source"] }],
    "import-notation": "string",
    "at-rule-empty-line-before": [
      "always",
      {
        except: ["blockless-after-same-name-blockless", "first-nested"],
        ignore: ["after-comment"],
        ignoreAtRules: ["source"],
      },
    ],
  },
};
