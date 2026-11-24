import js from "@eslint/js";
import react from "@eslint-react/eslint-plugin";
import tailwind from "eslint-plugin-better-tailwindcss";
import boundaries from "eslint-plugin-boundaries";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import vibelang from "vibelang/eslint";
import { vibestackConfig } from "vibestack/eslint";

export default vibestackConfig({
  root: import.meta.dirname,
  design: "packages/design-system",
  plugins: { js, tseslint, vibelang, react, reactHooks, boundaries, tailwind },
  commented: {
    "apps/app/src/App.tsx": 5, "apps/app/src/greeter.vibe": 5, "apps/app/src/greeting.ts": 1, "apps/app/src/link.contract.ts": 2, "apps/app/src/link.ts": 3,
    "apps/app/test/app.browser.test.tsx": 5, "apps/app/test/app.test.vibe": 4, "apps/app/test/bombadil.ts": 4, "apps/app/test/drivers/app.ts": 5,
    "packages/ui/.storybook/preview.ts": 1, "packages/ui/src/components/Button.meta.tsx": 4, "packages/ui/src/components/Button.tsx": 1,
    "packages/ui/src/components/Card.meta.tsx": 1, "packages/ui/src/components/Dialog.meta.tsx": 2, "packages/ui/src/components/Progress.tsx": 1,
    "packages/ui/src/lib/cn.ts": 2, "packages/ui/vite.config.ts": 1, "packages/ui/vitest.config.ts": 1,
  },
  scheduled: { "apps/app/src/App.tsx": 2 },
});
