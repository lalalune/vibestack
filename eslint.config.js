import { readFileSync } from "node:fs"
import { relative, sep } from "node:path"
import js from "@eslint/js"
import react from "@eslint-react/eslint-plugin"
import tailwind from "eslint-plugin-better-tailwindcss"
import boundaries from "eslint-plugin-boundaries"
import reactHooks from "eslint-plugin-react-hooks"
import { defineConfig, globalIgnores } from "eslint/config"
import tseslint from "typescript-eslint"
import vibelang from "vibelang/eslint"
import { designSystem } from "./packages/vibestack/src/design/eslint.ts"
import { parseTokens } from "./packages/vibestack/src/design/tokens.ts"
import { withWorkspaceBarrels } from "./packages/vibestack/src/eslint.ts"

const stack = 'AGENTS.md, "The stack"'
const monorepo = 'CONTRIBUTING.md, "The monorepo"'
const banned = ["redux", "react-redux", "zustand", "mobx", "jotai", "recoil", "valtio", "xstate", "vue", "svelte", "jest"]
const scopes = ["reduxjs", "angular", "xstate", "vue", "sveltejs", "jest"]
const imports = {
  patterns: [
    // A package, its subpaths and its family: zustand/middleware, redux-saga, @angular/core.
    { regex: `^(?:@(?:${scopes.join("|")})/|(?:${banned.join("|")})(?:[/-]|$))`, message: `Not part of the stack: ${stack}.` },
  ],
}
const noReact = { patterns: [...imports.patterns, { regex: "^react(?:-dom)?(?:/|$)", message: `Tool and domain code does not import React: ${monorepo}.` }] }
// What no tsconfig.json includes, so the type-aware rules cannot see it.
const untyped = ["*.{js,ts}", "template/*.{js,ts}", "packages/*/scripts/**", "packages/vibestack/bin/**", "packages/vibestack/vitest.config.ts", "packages/create-vibestack/vitest.config.ts", "**/.storybook/**", "template/packages/design-system/**", "packages/vibestack/src/design/test/**", "packages/vibestack/src/stories/test/**"]
// Every React interface: Studio's page is built on the same theme (packages/studio/vite.config.ts).
const tsx = ["apps/**/*.{ts,tsx}", "template/packages/ui/**/*.{ts,tsx}", "template/apps/**/*.{ts,tsx}", "packages/studio/src/page/**/*.{ts,tsx}"]
const design = "template/packages/design-system"
const writing = 'AGENTS.md, "Writing code"'
const citation = String.raw`spec\/\S+\.md, "[^"]+"`
const suppressible = String.raw`(?!code\/|barrel\/|no-console\b)[\w@/-]+`
const cited = new RegExp(String.raw`^\s*${citation}(?:; ${citation})*\s*$`)
const suppression = new RegExp(String.raw`^ eslint-disable(?:-next-line|-line)? ${suppressible}(?:, ${suppressible})* -- \S`)
const configs = [suppression, /^ eslint-enable\b/]
const throwsType = String.raw`[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*`
const throwsDirective = new RegExp(String.raw`^\*(?:[\s*]*@throws \{[ \t]*${throwsType}(?:[ \t]*\|[ \t]*${throwsType})*[ \t]*\})+[\s*]*$`)
const directives = {
  Line: [cited, suppression, /^@ (?:backend|requires|ensures|invariant|decreases|assert|pure|type|ghost)(?: |$)/, /^\/ <reference /, /^ @vitest-environment [\w-]+$/],
  Block: [cited, ...configs, /^\*(?:[\s*]*@(?:model|design) \S+)+[\s*]*$/, throwsDirective],
  Shebang: [/^/],
}
const inline = /^\s*(?:eslint(?:-[a-z]+)*|exported|globals?)(?:\s|$)/
const guarded = (parser) => ({
  meta: { name: `${parser.meta.name} with code/inline`, version: parser.meta.version },
  parseForESLint: (text, options) => {
    const parsed = parser.parseForESLint(text, options)
    const loose = parsed.ast.comments.find((comment) => inline.test(comment.value) && !configs.some((form) => form.test(comment.value)))
    if (loose) throw Object.assign(new SyntaxError(`Inline config here is only "eslint-disable[-next-line|-line] <rule>, … -- <reason>", never for code/*, barrel/* or no-console, and "eslint-enable" (${writing}).`), { lineNumber: loose.loc.start.line, column: loose.loc.start.column + 1 })
    return parsed
  },
})
const within = (node) => Boolean(node) && (/Function/.test(node.type) || within(node.parent))
const documented = (context, comment) => context.options[0]?.jsdoc && comment.type === "Block" && comment.value.startsWith("*") && !within(context.sourceCode.getNodeByRangeIndex(comment.range[0]))
const left = { type: "object", additionalProperties: { type: "integer", minimum: 1 } }
const excess = (context, node, found, kind) => {
  const rel = relative(context.cwd, context.filename).split(sep).join("/")
  const limits = context.options[0]?.left
  const allowed = limits && Object.hasOwn(limits, rel) ? limits[rel] : 0
  if (found.length > allowed) found.forEach((problem) => context.report(problem))
  else if (allowed > 0 && found.length < allowed) context.report({ node, message: found.length ? `Stale ${kind} ratchet (${allowed}) for "${rel}": ${found.length} remain; lower it to ${found.length}.` : `Stale ${kind} ratchet (${allowed}) for "${rel}": 0 remain; remove it.` })
}
const comments = {
  meta: { type: "problem", schema: [{ type: "object", properties: { jsdoc: { type: "boolean" }, left }, additionalProperties: false }] },
  create: (context) => ({
    Program: (node) => excess(context, node, context.sourceCode.getAllComments()
      .filter((comment) => !directives[comment.type].some((directive) => directive.test(comment.value)) && !documented(context, comment))
      .map((comment) => ({ loc: comment.loc, message: `No code comments: only spec citations and tool directives (${writing}).` })), "commented"),
  }),
}
const uses = (names) => `:matches(Identifier[name=${names}]:not(ImportSpecifier[imported.name=${names}] > Identifier.local):not(ObjectExpression > Property[computed=false][shorthand=false] > Identifier.key), MemberExpression[computed=true] > Literal.property[value=${names}])`
const scheduling = {
  [uses(/^use(?:Layout|Insertion)?Effect$/)]: `No effect hooks: shared state lives in the spec-backed Machine (${writing}).`,
  [uses(/^(?:setTimeout|setInterval|setImmediate|queueMicrotask|requestAnimationFrame|requestIdleCallback)$/)]: `No timers: wait with Effect in VibeLang, or let the Machine say when (${writing}).`,
}
const effects = {
  meta: { type: "problem", schema: [{ type: "object", properties: { left }, additionalProperties: false }] },
  create: (context) => {
    const found = []
    return { ...Object.fromEntries(Object.entries(scheduling).map(([selector, message]) => [selector, (node) => found.push({ node, message })])), "Program:exit": (node) => excess(context, node, found, "scheduled") }
  },
}
const code = { rules: { comments, effects } }
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

// The tool reads Quint's JSON and the TypeScript compiler API as `any` at its boundaries; packages and apps stay strict.
const loose = Object.fromEntries(["no-explicit-any", "no-unsafe-argument", "no-unsafe-assignment", "no-unsafe-call", "no-unsafe-member-access", "no-unsafe-return"].map((rule) => [`@typescript-eslint/${rule}`, "off"]))

export default withWorkspaceBarrels(defineConfig(
  // Generated or disposable, and .claude/worktrees holds other checkouts of this repository.
  globalIgnores(["**/gen/", "!packages/vibestack/src/gen/", "**/.vibe/", "**/dist/", "**/.cache/", "**/.spec-cache/", "**/generated/", "**/storybook-static/", "**/test/fixture/", "**/test/fixtures/", "packages/vibestack/assets/", "packages/create-vibestack/template/", "examples/", "selftest/fixtures/", ".claude/", ".lemmascript/", ".studio/", ".turbo/", "_apalache-out/"]),
  { linterOptions: { reportUnusedDisableDirectives: "error", reportUnusedInlineConfigs: "error" } },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
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
      "no-restricted-imports": ["error", imports],
      // A relative path stays inside its package; the tool, Studio, and selftest share tool internals.
      "boundaries/dependencies": ["error", {
        default: "disallow",
        policies: [
          { from: { element: { type: "package" } }, allow: { to: { element: { type: "package", captured: { name: "{{ from.element.captured.name }}" } } } } },
          { from: { element: { types: ["tool", "studio", "selftest"] } }, allow: { to: { element: { types: ["tool", "studio", "selftest"] } } } },
        ],
      }],
      // Nor does it reach a file outside every package and the tool.
      "boundaries/no-unknown-dependencies": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      // node:test runs what `test` and `describe` return; an async event listener is awaited by nobody by design.
      "@typescript-eslint/no-floating-promises": ["error", { allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: ["test", "describe", "it"] }] }],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false } }],
      // Regular expressions here match the tools' column-aligned output, where literal spaces read as the output does.
      "no-regex-spaces": "off",
      // AGENTS.md, "Writing code": one path, so nothing is left for later or kept beside its replacement.
      "no-warning-comments": ["error", { terms: ["todo", "fixme", "legacy", "deprecated"], location: "anywhere" }],
    },
  },
  { files: untyped, extends: [tseslint.configs.disableTypeChecked] },
  // A ratchet at today's longest (Studio's server); a test's describe block holds its cases.
  { ignores: ["**/test/**", "selftest/**"], rules: { "max-lines-per-function": ["error", { max: 250, skipBlankLines: true, skipComments: true }] } },
  {
    files: ["packages/vibestack/**", "packages/studio/**", "packages/create-vibestack/**", "selftest/**"],
    ignores: ["**/*.tsx"],
    rules: {
      ...loose,
      // `value!` after a check the compiler cannot follow is this code's style, also where a later TypeScript made it redundant.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      // `unknown | Promise<unknown>` and `Json | undefined` document intent although `unknown` and `any` absorb the rest.
      "@typescript-eslint/no-redundant-type-constituents": "off",
      // The TypeScript API compares masked flags: `(flags & NodeFlags.BlockScoped) === NodeFlags.Const`.
      "@typescript-eslint/no-unsafe-enum-comparison": "off",
      // Node types execFile's error as an intersection of Omit<>s, which the rule does not see is an Error.
      "@typescript-eslint/prefer-promise-reject-errors": "off",
      // The compiler host's methods and a driver's functions are passed around as plain functions that use no `this`.
      "@typescript-eslint/unbound-method": "off",
      // Studio's DOM helpers stringify attribute values and children typed `unknown`.
      "@typescript-eslint/no-base-to-string": "off",
    },
  },
  // VibeLang's parser gives .vibe files typescript-eslint's tree without a program, so the rules that need types stay off: `vibelang --noEmit` checks them.
  { files: ["**/*.{vibe,vibex}"], extends: [tseslint.configs.disableTypeChecked], languageOptions: { parser: vibelang, parserOptions: { projectService: false } }, rules: { "no-undef": "off" } },
  // React belongs to interfaces: the tools apart from Studio's page, and schemas, contracts, drivers and the shell everywhere, do without it.
  {
    files: ["packages/vibestack/**", "packages/studio/src/**", "packages/create-vibestack/**", "**/*.{schema,contract}.ts", "**/test/drivers/**", "**/*.vibe"],
    ignores: ["packages/studio/src/page/**"],
    rules: { "no-restricted-imports": ["error", noReact] },
  },
  // eslint-plugin-react-hooks owns the rules both plugins ship; @eslint-react adds the rest.
  {
    files: ["**/*.tsx"],
    extends: [react.configs["recommended-type-checked"], reactHooks.configs.flat.recommended],
    rules: Object.fromEntries(Object.keys(reactHooks.rules).filter((rule) => `@eslint-react/${rule}` in react.configs["recommended-type-checked"].rules).map((rule) => [`@eslint-react/${rule}`, "off"])),
  },
  // packages/vibestack/src/design/eslint.ts: token classes only, read from the theme `pnpm --filter @repo/design-system build` writes.
  {
    files: tsx,
    extends: [designSystem({ tailwind, tokens: parseTokens(JSON.parse(readFileSync(`${design}/tokens.json`, "utf8"))), entryPoint: `${import.meta.dirname}/${design}/generated/theme.css` })],
    settings: { "better-tailwindcss": { cwd: design } },
  },
  // @repo/ui holds the form controls and dialogs every interface uses.
  {
    files: tsx,
    ignores: ["template/packages/ui/**"],
    rules: {
      "no-restricted-globals": ["error", ...["alert", "confirm", "prompt"].map((name) => ({ name, message: "Use Dialog or Alert from @repo/ui." }))],
      "no-restricted-syntax": ["error", { selector: "JSXOpeningElement[name.name=/^(input|textarea)$/]", message: "Use Input, Textarea or Checkbox from @repo/ui." }],
    },
  },
  { files: own, ignores: ["**/*.{vibe,vibex}"], languageOptions: { parser: guarded(tseslint.parser) } },
  { files: ["template/{apps,packages}/**/*.{vibe,vibex}"], languageOptions: { parser: guarded(vibelang) } },
  { files: own, plugins: { code }, rules: { "no-console": "error", "code/comments": ["error", { left: commented }], "code/effects": ["error", { left: scheduled }] } },
  { files: ["template/packages/ui/src/components/**"], ignores: ["**/*.meta.tsx"], rules: { "code/comments": ["error", { jsdoc: true, left: commented }] } },
), { root: import.meta.dirname })
