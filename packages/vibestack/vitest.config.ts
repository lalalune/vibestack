// The tools' own tests: src/{testing,stories,design}/test.
import { project } from "./src/testing/vitest.ts";

export default project({ root: import.meta.dirname, tests: ["src/testing/test/*.test.ts", "src/stories/test/*.test.ts", "src/design/test/*.test.ts"] });
