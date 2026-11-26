import {
  planModel,
  type ComparisonShape,
  type ModelPath,
  type ModelPlan,
  type ModelStep,
  type Oracle,
  type PathStrategy,
  type PlanOptions,
  type Sent,
  type TransitionCoverage,
} from "../conformance.ts";

export {
  planModel,
  type ModelPath,
  type ModelPlan,
  type ModelStep,
  type PathStrategy,
  type PlanOptions,
  type TransitionCoverage,
};

export type ModelState<O> = O extends { readonly initial: infer S } ? S : never;
export type ModelEvent<O> = O extends { parseEvent(raw: unknown): infer E } ? Extract<Exclude<E, undefined>, { readonly type: string }> : never;
export type ModelSender<O> = O extends { parseSender(raw: unknown): infer B } ? Exclude<B, undefined> : undefined;
export type ModelInput<E, By> = [By] extends [undefined] ? E : E & { readonly by: By };

export interface ModelStepMeta<S, By> {
  readonly path: string;
  readonly index: number;
  readonly before: S;
  readonly after: S;
  readonly allowed: boolean;
  readonly by: By;
  readonly out?: unknown;
}

export interface ModelStateMeta<S, E, By> {
  readonly path: string;
  readonly index: number;
  readonly targetState: string;
  readonly step?: ModelStep<S, E>;
  readonly by?: By;
}

export type EventHandlers<S, E extends { readonly type: string }, By, Ctx> = {
  readonly [K in E["type"]]: (
    event: Extract<E, { readonly type: K }>,
    ctx: Ctx,
    meta: ModelStepMeta<S, By>,
  ) => void | Promise<void>;
};

export interface ModelAdapter<S, E extends { readonly type: string }, By, Ctx> {
  readonly setup: () => Ctx | Promise<Ctx>;
  readonly teardown?: (ctx: Ctx) => void | Promise<void>;
  readonly events: EventHandlers<S, E, By, Ctx>;
  readonly assertState: (state: S, ctx: Ctx, meta: ModelStateMeta<S, E, By>) => void | Promise<void>;
  readonly assertRefusal?: (
    event: ModelInput<E, By>,
    state: S,
    ctx: Ctx,
    meta: ModelStepMeta<S, By>,
  ) => void | Promise<void>;
}

export interface RunModelOptions<S, E, By> extends PlanOptions<S, E> {
  readonly events: readonly ModelInput<E, By>[];
  readonly shape?: ComparisonShape;
  readonly assertCoverage?: boolean;
}

export interface ModelRunReport<S, E> {
  readonly strategy: PathStrategy;
  readonly paths: number;
  readonly steps: number;
  readonly coverage: ModelPlan<S, E>["coverage"];
}

function wrapModelError(where: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`Model test failed at ${where}: ${detail}`, { cause: error });
}

export async function runModel<O extends Oracle<any, any>, Ctx>(
  oracle: O,
  adapter: ModelAdapter<ModelState<O>, ModelEvent<O>, ModelSender<O>, Ctx>,
  options: RunModelOptions<ModelState<O>, ModelEvent<O>, ModelSender<O>>,
): Promise<ModelRunReport<ModelState<O>, ModelEvent<O>>> {
  type S = ModelState<O>;
  type E = ModelEvent<O>;
  type By = ModelSender<O>;
  if (!options.events.length) {
    throw new Error("Model test requires at least one event");
  }
  const transitionNames = Object.keys(adapter.events).sort();
  const plan = planModel<S, E>(oracle as Oracle<S, E>, options.events as readonly Sent<E>[], options.shape ?? "scalar", {
    ...options,
    transitions: options.transitions ?? transitionNames,
  });

  if (options.assertCoverage && plan.coverage.transitions.uncovered.length > 0) {
    throw new Error(
      `Model test uncovered transitions (${plan.coverage.transitions.accepted.length}/${plan.coverage.transitions.total}): ${plan.coverage.transitions.uncovered.join(", ")}`,
    );
  }

  const runWithContext = async (body: (ctx: Ctx) => Promise<void>) => {
    const ctx = await adapter.setup();
    let primaryError: unknown;
    let failed = false;
    try {
      await body(ctx);
    } catch (error) {
      failed = true;
      primaryError = error;
    }
    try {
      await adapter.teardown?.(ctx);
    } catch (teardownError) {
      if (!failed) throw teardownError;
      const primaryMsg = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const teardownMsg = teardownError instanceof Error ? teardownError.message : String(teardownError);
      throw new Error(`${primaryMsg} (teardown also failed: ${teardownMsg})`, { cause: teardownError });
    }
    if (failed) throw primaryError;
  };

  let totalSteps = 0;
  if (!plan.paths.length) {
    await runWithContext(async (ctx) => {
      try {
        await adapter.assertState(oracle.initial, ctx, { path: "initial", index: 0, targetState: "initial" });
      } catch (error) {
        throw wrapModelError('path "initial", initial state', error);
      }
    });
  }
  for (const modelPath of plan.paths) {
    await runWithContext(async (ctx) => {
      try {
        await adapter.assertState(oracle.initial, ctx, {
          path: modelPath.description,
          index: 0,
          targetState: modelPath.targetState,
        });
      } catch (error) {
        throw wrapModelError(`path "${modelPath.description}", initial state`, error);
      }

      for (const [index, step] of modelPath.steps.entries()) {
        totalSteps++;
        const { by, ...raw } = step.event as Sent<E> & Record<string, unknown>;
        const event = raw as E;
        const meta: ModelStepMeta<S, By> = {
          path: modelPath.description,
          index: index + 1,
          before: step.before,
          after: step.after,
          allowed: step.allowed,
          by: by as By,
          ...(step.out !== undefined ? { out: step.out } : {}),
        };
        const label = `path "${modelPath.description}", step ${index + 1} (${event.type}${step.allowed ? "" : ", refused"})`;
        try {
          if (!step.allowed && adapter.assertRefusal) {
            await adapter.assertRefusal(step.event as ModelInput<E, By>, step.before, ctx, meta);
          } else {
            const handler = adapter.events[event.type as E["type"]] as
              | ((ev: E, c: Ctx, m: ModelStepMeta<S, By>) => void | Promise<void>)
              | undefined;
            if (typeof handler !== "function") {
              throw new Error(`No handler registered for event type "${event.type}"`);
            }
            await handler(event, ctx, meta);
          }
        } catch (error) {
          throw wrapModelError(label, error);
        }
        try {
          await adapter.assertState(step.after, ctx, {
            path: modelPath.description,
            index: index + 1,
            targetState: modelPath.targetState,
            step,
            by: by as By,
          });
        } catch (error) {
          throw wrapModelError(`${label}, state assertion`, error);
        }
      }
    });
  }

  return {
    strategy: plan.strategy,
    paths: plan.paths.length,
    steps: totalSteps,
    coverage: plan.coverage,
  };
}
