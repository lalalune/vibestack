import js from "@eslint/js"
import react from "@eslint-react/eslint-plugin"
import tailwind from "eslint-plugin-better-tailwindcss"
import boundaries from "eslint-plugin-boundaries"
import reactHooks from "eslint-plugin-react-hooks"
import tseslint from "typescript-eslint"
import vibelang from "vibelang/eslint"
import { STACK_IMPORT_PATTERNS, vibestackConfig } from "./packages/vibestack/src/eslint.ts"

const monorepo = 'CONTRIBUTING.md, "The monorepo"'
const noReact = { patterns: [...STACK_IMPORT_PATTERNS, { regex: "^react(?:-dom)?(?:/|$)", message: `Tool and domain code does not import React: ${monorepo}.` }] }
const untyped = ["*.{js,ts}", "template/*.{js,ts}", "**/alchemy.run.ts", "**/deploy/**", "packages/*/scripts/**", "packages/vibestack/bin/**", "packages/vibestack/vitest.config.ts", "packages/create-vibestack/vitest.config.ts", "**/.storybook/**", "template/packages/design-system/**", "packages/vibestack/src/design/test/**", "packages/vibestack/src/stories/test/**"]
const tsx = ["apps/**/*.{ts,tsx}", "template/packages/ui/**/*.{ts,tsx}", "template/apps/**/*.{ts,tsx}", "packages/studio/src/page/**/*.{ts,tsx}"]
const own = ["apps/**", "template/apps/**", "template/packages/**"]
const commented = {
  "template/apps/app/src/App.tsx": 5,
  "template/apps/app/src/greeter.vibe": 5,
  "template/apps/app/src/greeting.ts": 1,
  "template/apps/app/src/link.contract.ts": 2,
  "template/apps/app/src/link.ts": 3,
  "template/apps/app/test/app.browser.test.tsx": 5,
  "template/apps/app/test/app.test.vibe": 4,
  "template/apps/app/test/bombadil.ts": 4,
  "template/apps/app/test/drivers/app.ts": 5,
  "template/packages/ui/.storybook/preview.ts": 1,
  "template/packages/ui/src/components/Button.meta.tsx": 4,
  "template/packages/ui/src/components/Button.tsx": 1,
  "template/packages/ui/src/components/Card.meta.tsx": 1,
  "template/packages/ui/src/components/Dialog.meta.tsx": 2,
  "template/packages/ui/src/components/Progress.tsx": 1,
  "template/packages/ui/src/lib/cn.ts": 2,
  "template/packages/ui/vite.config.ts": 1,
  "template/packages/ui/vitest.config.ts": 1,
}
const scheduled = { "template/apps/app/src/App.tsx": 2 }
const loose = Object.fromEntries(["no-explicit-any", "no-unsafe-argument", "no-unsafe-assignment", "no-unsafe-call", "no-unsafe-member-access", "no-unsafe-return"].map((rule) => [`@typescript-eslint/${rule}`, "off"]))

export default vibestackConfig({
  root: import.meta.dirname,
  design: "template/packages/design-system",
  uiPackage: "template/packages/ui",
  tsx,
  own,
  untyped,
  ignores: ["!packages/vibestack/src/gen/", "**/test/fixture/", "packages/vibestack/assets/", "packages/create-vibestack/template/", "examples/", "selftest/fixtures/"],
  commented,
  scheduled,
  plugins: { js, tseslint, vibelang, react, reactHooks, tailwind },
  extra: [
    {
      plugins: { boundaries },
      settings: {
        "boundaries/elements": [
          { type: "package", pattern: ["apps/*", "template/packages/*", "template/apps/*", "packages/create-vibestack"], capture: ["name"] },
          { type: "studio", pattern: "packages/studio" },
          { type: "tool", pattern: "packages/vibestack" },
          { type: "selftest", pattern: "selftest" },
        ],
      },
      rules: {
        "boundaries/dependencies": ["error", {
          default: "disallow",
          policies: [
            { from: { element: { type: "package" } }, allow: { to: { element: { type: "package", captured: { name: "{{ from.element.captured.name }}" } } } } },
            { from: { element: { types: ["tool", "studio", "selftest"] } }, allow: { to: { element: { types: ["tool", "studio", "selftest"] } } } },
          ],
        }],
        "boundaries/no-unknown-dependencies": "error",
      },
    },
    { files: ["selftest/**"], rules: { "max-lines-per-function": "off" } },
    {
      files: ["packages/vibestack/**", "packages/studio/**", "packages/create-vibestack/**", "selftest/**"],
      ignores: ["**/*.tsx"],
      rules: {
        ...loose,
        "@typescript-eslint/no-unnecessary-type-assertion": "off",
        "@typescript-eslint/no-redundant-type-constituents": "off",
        "@typescript-eslint/no-unsafe-enum-comparison": "off",
        "@typescript-eslint/prefer-promise-reject-errors": "off",
        "@typescript-eslint/unbound-method": "off",
        "@typescript-eslint/no-base-to-string": "off",
      },
    },
    {
      files: ["packages/vibestack/**", "packages/studio/src/**", "packages/create-vibestack/**"],
      ignores: ["packages/studio/src/page/**"],
      rules: { "no-restricted-imports": ["error", noReact] },
    },
  ],
})
