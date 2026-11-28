import type { RegisteredCommand } from "../runner.ts";
import { deployCommand } from "./deploy.ts";
import { statusCommand } from "./status.ts";

export const commands: readonly RegisteredCommand[] = [statusCommand, deployCommand];
