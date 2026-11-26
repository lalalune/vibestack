// Knip reads .vibe files through VibeLang's own compiler, which gives it a module's imports and exports without bodies.
// Each exception below names something Knip cannot follow:
//   ignore examples/**                      standalone projects with their own install, outside the workspace
//   ignore **/test/fixtures/**              inputs the tools' tests read as text, never imported
//   ignoreIssues server.vibe exports        AGENTS is used in its own file, in a body ignoreExportsUsedInFile cannot see
//   @informalsystems/quint, lemmascript     run as executables by units.ts and prove.ts
//   root @vitest/browser                    loaded by Vitest's browser mode, beside @vitest/browser-playwright
//   root @repo/design-system                read as files by design.test.ts
//   tailwindcss (ui, design-system, studio, apps)  resolved by @tailwindcss/vite and the lint plugin from CSS
//   entry *.schema, *.contract              imported by the tests generate.ts writes under .cache/
//   design-system eslint, eslint-plugin-better-tailwindcss, typescript-eslint  loaded by name in design.test.ts
import vibelang from "vibelang/knip"

export default {
  compilers: { vibe: vibelang, vibex: vibelang },
  "ignore": [
    "examples/**",
    "packages/vibestack/assets/**",
    "packages/create-vibestack/template/**",
    "template/*.{js,ts}",
    "**/test/fixtures/**"
  ],
  "ignoreExportsUsedInFile": true,
  "ignoreIssues": {
    "packages/studio/src/server.vibe": ["exports"]
  },
  "workspaces": {
    ".": {
      "entry": [
        "selftest/selftest.ts",
        "selftest/selftests/*.ts"
      ],
      "project": [
        "selftest/**/*.ts"
      ],
      "ignoreDependencies": [
        "@antithesishq/bombadil",
        "@effect/platform-node",
        "@effect/vitest",
        "@informalsystems/quint",
        "@vitest/browser",
        "@vitest/browser-playwright",
        "happy-dom",
        "jscpd",
        "jsdom",
        "lemmascript",
        "madge",
        "playwright",
        "vibelang-runtime",
        "vibelang-vite",
        "vite"
      ]
    },
    "packages/vibestack": {
      "entry": [
        "scripts/build.mjs",
        "src/spec.ts",
        "src/skill-links.ts",
        "src/design/cli.ts",
        "src/stories/cli.ts",
        "src/remote-cache.ts",
        "src/chromium.ts",
        "src/formal.ts",
        "src/eslint.ts",
        "src/config.ts",
        "src/testing/{index,vitest,generate}.ts",
        "src/stories/{meta,storybook}.ts",
        "src/design/{eslint,tokens,project}.ts",
        "src/*/test/*.test.ts",
        "src/testing/test/fixture/*/src/*.{schema,contract}.{ts,vibe}"
      ],
      "project": [
        "src/**/*.{ts,tsx,vibe,vibex}",
        "scripts/*.mjs"
      ],
      "ignoreDependencies": [
        "@antithesishq/bombadil",
        "@informalsystems/quint",
        "lemmascript",
        "playwright"
      ]
    },
    "packages/studio": {
      "entry": [
        "scripts/build.mjs",
        "src/main.vibe",
        "src/project.ts",
        "src/doc.ts",
        "pack-page.ts"
      ],
      "project": [
        "src/**/*.{ts,tsx,vibe,vibex,css}",
        "test/**/*.{ts,tsx,vibe,vibex}",
        "scripts/*.mjs",
        "pack-page.ts"
      ],
      "ignoreDependencies": [
        "tailwindcss"
      ]
    },
    "packages/create-vibestack": {
      "entry": [
        "scripts/build.mjs",
        "src/cli.ts",
        "test/*.test.ts"
      ],
      "project": [
        "src/**/*.ts",
        "test/**/*.ts",
        "scripts/*.mjs"
      ]
    },
    "template/packages/ui": {
      "entry": [
        "src/**/*.{meta,stories}.tsx"
      ],
      "project": [
        "**/*.{ts,tsx,vibe,vibex,css}"
      ],
      "ignoreDependencies": [
        "tailwindcss",
        "vibestack"
      ]
    },
    "template/packages/design-system": {
      "ignoreDependencies": [
        "eslint",
        "eslint-plugin-better-tailwindcss",
        "tailwindcss",
        "typescript-eslint",
        "vibestack"
      ]
    },
    "template/packages/cli": {
      "entry": [
        "src/main.ts",
        "src/index.ts",
        "test/**/*.test.ts"
      ],
      "project": [
        "src/**/*.ts",
        "test/**/*.ts"
      ],
      "ignoreDependencies": [
        "vibestack"
      ]
    },
    "apps/*": {
      "project": [
        "src/**/*.{ts,tsx,vibe,vibex,css}"
      ],
      "ignoreDependencies": [
        "tailwindcss"
      ]
    },
    "template/apps/*": {
      "entry": [
        "test/**/*.test.{ts,tsx,vibe}",
        "test/drivers/*.ts",
        "src/**/*.{schema,contract}.{ts,vibe}"
      ],
      "project": [
        "src/**/*.{ts,tsx,vibe,vibex,css}",
        "test/**/*.{ts,tsx,vibe,vibex}"
      ],
      "ignoreDependencies": [
        "tailwindcss",
        "vibestack"
      ]
    }
  }
}
