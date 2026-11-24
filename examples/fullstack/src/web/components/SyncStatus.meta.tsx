import type { ComponentMeta } from "vibestack/stories";
import type { SyncStatusProps } from "./SyncStatus.tsx";
import { offline } from "./clients.ts";

export const meta: ComponentMeta<SyncStatusProps> = {
  examples: { Offline: { client: offline } },
};
