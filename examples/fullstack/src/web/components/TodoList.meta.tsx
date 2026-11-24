import type { ComponentMeta } from "vibestack/stories";
import type { TodoListProps } from "./TodoList.tsx";
import { offline, synced } from "./clients.ts";

export const meta: ComponentMeta<TodoListProps> = {
  args: { client: synced },
  examples: { Offline: { client: offline } },
};
