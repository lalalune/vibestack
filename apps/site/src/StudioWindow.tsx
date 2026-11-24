import { useMemo, useState, type ReactNode } from "react";
import { Button, Card, CardFooter, CardTitle, Progress, cn, focusRing } from "@repo/ui";
import { StateCanvas } from "./StateCanvas.tsx";
import {
  CHECK_STAGES,
  PIPELINE_STEPS,
  formatCents,
  initialCursor,
  projectStudio,
  resetCursor,
  resolveControlTransition,
  stepCursor,
  type ControlId,
  type DensityMode,
  type LayoutPartId,
  type RuleId,
  type SpecRegistry,
  type StateId,
  type StudioCursor,
  type StudioFocus,
  type StudioProjection,
  type TransitionId,
} from "./studioData.ts";

const QUINT_KEYWORD_SET = new Set([
  "pure",
  "def",
  "val",
  "type",
  "if",
  "else",
  "and",
  "or",
  "not",
  "implies",
  "int",
  "bool",
]);

function QuintSnippet({ code }: { readonly code: string }) {
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const hit of code.matchAll(/\b(\d+)\b|\b([A-Za-z_]\w*)\b/g)) {
    const start = hit.index;
    if (start > offset) parts.push(code.slice(offset, start));
    const num = hit[1];
    const word = hit[2];
    if (num) {
      parts.push(
        <span key={start} className="text-warn">
          {num}
        </span>,
      );
    } else if (word && QUINT_KEYWORD_SET.has(word)) {
      parts.push(
        <span key={start} className="text-primary">
          {word}
        </span>,
      );
    } else {
      parts.push(word);
    }
    offset = start + hit[0].length;
  }
  if (offset < code.length) parts.push(code.slice(offset));

  return (
    <pre className="rounded-md border border-border bg-muted/60 px-2.5 py-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-foreground">
      <code>{parts}</code>
    </pre>
  );
}

function StatusIndicator({ status }: { readonly status: StateId }) {
  const dotColor =
    status === "Paid"
      ? "bg-ok"
      : status === "OnHold"
        ? "bg-warn"
        : status === "Pending"
          ? "bg-primary"
          : "bg-muted-foreground";

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-foreground">
      <span aria-hidden className={cn("size-2 rounded-full", dotColor)} />
      {status}
    </span>
  );
}

function OrderPreviewCard({
  spec,
  cursor,
  view,
  onTriggerTransition,
  onFocusControl,
}: {
  readonly spec: SpecRegistry;
  readonly cursor: StudioCursor;
  readonly view: StudioProjection;
  readonly onTriggerTransition: (id: TransitionId) => void;
  readonly onFocusControl: (id: ControlId) => void;
}) {
  const { snapshot, inspect } = cursor;

  return (
    <Card className="w-full max-w-sm gap-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <CardTitle>Order</CardTitle>
        <StatusIndicator status={snapshot.status} />
      </div>

      <div
        className={cn(
          "flex flex-col gap-2 rounded-md border p-3 transition-colors duration-fast",
          view.highlightedPart === "BalanceMeter"
            ? "border-primary bg-accent/50"
            : "border-border bg-muted/40",
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-2xl font-semibold tracking-tight tabular-nums">
            {formatCents(snapshot.paid)}
            <span className="text-sm font-normal text-muted-foreground">
              {" "}
              / {formatCents(snapshot.due)}
            </span>
          </span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {snapshot.units}u
          </span>
        </div>
        <Progress value={view.paidRatio} max={100} aria-label="Payment progress" />
      </div>

      <CardFooter
        className={cn(
          "flex-wrap justify-start gap-2 rounded-md p-1 transition-colors duration-fast",
          view.highlightedPart === "ActionBar" && "bg-accent/50 ring-1 ring-primary",
        )}
      >
        {spec.controlOrder.map((controlId) => {
          const control = spec.controls[controlId];
          const target = resolveControlTransition(spec, controlId, snapshot);
          const enabled = target.canFire(snapshot);
          const highlighted = view.highlightedControls.has(controlId);

          return (
            <div key={controlId} className="flex flex-col items-start gap-1">
              <Button
                size="sm"
                variant={enabled ? control.variant : "secondary"}
                disabled={!enabled}
                className={cn(highlighted && "ring-2 ring-primary ring-offset-1 ring-offset-card")}
                onMouseEnter={() => onFocusControl(controlId)}
                onFocus={() => onFocusControl(controlId)}
                onClick={() => onTriggerTransition(target.id)}
              >
                {control.label(snapshot)}
              </Button>
              {inspect && (
                <span
                  className={cn(
                    "font-mono text-xs",
                    highlighted ? "font-medium text-primary" : "text-muted-foreground",
                  )}
                >
                  → {target.id}
                </span>
              )}
            </div>
          );
        })}
      </CardFooter>
    </Card>
  );
}

function CompositionBar({
  spec,
  activePart,
  onSelectPart,
}: {
  readonly spec: SpecRegistry;
  readonly activePart: LayoutPartId | null;
  readonly onSelectPart: (partId: LayoutPartId) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Component tree"
      className="flex flex-wrap items-center gap-1 text-xs"
    >
      {spec.partOrder.map((partId, index) => (
        <span key={partId} className="inline-flex items-center gap-1">
          {index > 0 && (
            <span aria-hidden className="text-muted-foreground">
              {index === 1 ? "›" : "·"}
            </span>
          )}
          <button
            type="button"
            aria-pressed={activePart === partId}
            onClick={() => onSelectPart(partId)}
            className={cn(
              focusRing,
              "rounded-sm px-2 py-0.5 font-mono transition-colors duration-fast hover:bg-accent",
              activePart === partId
                ? "bg-accent font-medium text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {partId}
          </button>
        </span>
      ))}
    </div>
  );
}

function StoriesPane({
  spec,
  density,
  view,
  onSelectRule,
}: {
  readonly spec: SpecRegistry;
  readonly density: DensityMode;
  readonly view: StudioProjection;
  readonly onSelectRule: (ruleId: RuleId) => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      {spec.storyOrder.map((storyId) => {
        const story = spec.stories[storyId];
        return (
          <div
            key={storyId}
            className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3"
          >
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-xs font-semibold text-foreground">{story.title}</span>
              <span className="font-mono text-xs text-ok">✓ {story.rules.length}</span>
            </div>
            <div className="flex flex-col gap-1">
              {story.rules.map((ruleId) => {
                const rule = spec.rules[ruleId];
                const active = view.highlightedRules.has(ruleId);
                return (
                  <button
                    key={ruleId}
                    type="button"
                    onClick={() => onSelectRule(ruleId)}
                    className={cn(
                      focusRing,
                      "flex flex-col gap-1.5 rounded-md border px-2.5 py-2 text-left transition-colors duration-fast hover:bg-accent/40",
                      active ? "border-primary bg-accent/40" : "border-transparent bg-background",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={cn(
                          "size-1.5 flex-none rounded-full",
                          rule.kind === "always"
                            ? "bg-ok"
                            : rule.kind === "sometimes"
                              ? "bg-warn"
                              : "bg-primary",
                        )}
                      />
                      <span className="text-xs font-medium text-foreground">{rule.heading}</span>
                    </div>
                    {density === "quint" && <QuintSnippet code={rule.quint} />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatesInspector({
  spec,
  cursor,
  view,
}: {
  readonly spec: SpecRegistry;
  readonly cursor: StudioCursor;
  readonly view: StudioProjection;
}) {
  const activeTransition =
    cursor.focus.kind === "transition"
      ? spec.transitions[cursor.focus.transitionId]
      : cursor.snapshot.lastTransition
        ? spec.transitions[cursor.snapshot.lastTransition]
        : spec.transitions.submit;

  return (
    <aside className="flex flex-col gap-3 border-t border-border bg-card p-4 lg:w-104 lg:flex-none lg:border-t-0 lg:border-l">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-semibold text-foreground">
            {activeTransition.label}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {activeTransition.from} → {activeTransition.to}
          </span>
        </div>
        <QuintSnippet code={activeTransition.quint} />
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        {view.invariants.map(({ rule, holds }) => (
          <div
            key={rule.id}
            className="flex items-start gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs leading-snug"
          >
            <span
              aria-label={holds ? "holds" : "violated"}
              className={cn("font-mono font-semibold", holds ? "text-ok" : "text-destructive")}
            >
              {holds ? "✓" : "✗"}
            </span>
            <span className="font-mono text-foreground">{rule.heading}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

export function StudioWindow({ spec }: { readonly spec: SpecRegistry }) {
  const [cursor, setCursor] = useState<StudioCursor>(() => initialCursor(spec));
  const view = useMemo(() => projectStudio(spec, cursor), [spec, cursor]);

  const setFocus = (focus: StudioFocus) => {
    setCursor((prev) => ({ ...prev, focus }));
  };

  const triggerTransition = (id: TransitionId) => {
    setCursor((prev) => stepCursor(spec, prev, id));
  };

  return (
    <section
      aria-label="Vibestack Studio"
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
    >
      <div className="flex h-12 flex-none items-center justify-between gap-3 border-b border-border bg-card px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-6 flex-none place-items-center rounded-sm bg-primary font-mono text-xs font-bold text-primary-foreground"
          >
            V
          </span>
          <span className="truncate font-mono text-xs font-semibold text-foreground">
            {spec.projectName}
          </span>
          <span aria-hidden className="h-4 w-px bg-border" />
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
            Stories · Layout · States
          </span>
        </div>

        <ol
          aria-label="Spec pipeline"
          className="hidden items-center gap-2 text-xs text-ok lg:flex"
        >
          {PIPELINE_STEPS.map((step, index) => (
            <li key={step} className="flex items-center gap-1.5">
              {index > 0 && (
                <span aria-hidden className="text-muted-foreground">
                  ·
                </span>
              )}
              <span aria-hidden className="size-1.5 rounded-full bg-ok" />
              <span className="font-medium">{step}</span>
            </li>
          ))}
        </ol>

        <div className="flex flex-none items-center gap-1.5">
          <div
            role="group"
            aria-label="Spec density"
            className="flex items-center gap-0.5 rounded-md bg-muted p-0.5"
          >
            {(["prose", "quint"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={cursor.density === mode}
                onClick={() => setCursor((prev) => ({ ...prev, density: mode }))}
                className={cn(
                  focusRing,
                  "rounded-sm px-2 py-0.5 text-xs font-medium transition-colors duration-fast",
                  cursor.density === mode
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {mode === "prose" ? "Prose" : "+ Quint"}
              </button>
            ))}
          </div>

          <Button
            size="sm"
            variant={cursor.inspect ? "secondary" : "ghost"}
            aria-pressed={cursor.inspect}
            className="h-7 px-2 text-xs"
            onClick={() => setCursor((prev) => ({ ...prev, inspect: !prev.inspect }))}
          >
            Inspect
          </Button>

          {!view.isInitial && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setCursor((prev) => resetCursor(spec, prev))}
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 divide-border bg-background lg:grid-cols-12 lg:divide-x max-lg:divide-y">
        <div className="flex flex-col lg:col-span-7">
          <div className="flex h-9 flex-none items-center justify-between gap-2 border-b border-border bg-card/70 px-4">
            <span className="text-xs font-semibold text-foreground">Stories</span>
            <span className="font-mono text-xs text-muted-foreground">
              spec/{spec.moduleName}/index.md
            </span>
          </div>
          <StoriesPane
            spec={spec}
            density={cursor.density}
            view={view}
            onSelectRule={(ruleId) => setFocus({ kind: "rule", ruleId })}
          />
        </div>

        <div className="flex flex-col lg:col-span-5">
          <div className="flex h-9 flex-none items-center justify-between gap-2 border-b border-border bg-card/70 px-4">
            <span className="text-xs font-semibold text-foreground">Layout</span>
            <CompositionBar
              spec={spec}
              activePart={view.highlightedPart}
              onSelectPart={(partId) => setFocus({ kind: "part", partId })}
            />
          </div>
          <div className="flex flex-1 flex-col items-center justify-start gap-5 p-6">
            <OrderPreviewCard
              spec={spec}
              cursor={cursor}
              view={view}
              onTriggerTransition={triggerTransition}
              onFocusControl={(controlId) => setFocus({ kind: "control", controlId })}
            />
            <div className="flex w-full max-w-sm flex-col gap-1.5">
              <span className="font-mono text-xs text-muted-foreground">
                gen/{spec.moduleName}.ts
              </span>
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border font-mono text-xs">
                {[
                  ["status", cursor.snapshot.status],
                  ["units", String(cursor.snapshot.units)],
                  ["due", formatCents(cursor.snapshot.due)],
                  ["paid", formatCents(cursor.snapshot.paid)],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between bg-card px-3 py-2"
                  >
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium text-foreground tabular-nums">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col border-t border-border bg-background">
        <div className="flex h-9 flex-none items-center justify-between gap-2 border-b border-border bg-card/70 px-4">
          <span className="text-xs font-semibold text-foreground">
            States · <span className="font-mono font-normal text-muted-foreground">{spec.stateType}</span>
          </span>
          <span className="font-mono text-xs text-ok">
            ✓ {view.invariants.length}/{view.invariants.length} invariants
          </span>
        </div>
        <div className="flex flex-col lg:flex-row">
          <div className="flex min-w-0 flex-1 items-center justify-center p-3">
            <StateCanvas
              spec={spec}
              view={view}
              onSelectState={(stateId) => setFocus({ kind: "state", stateId })}
              onTriggerTransition={triggerTransition}
            />
          </div>
          <StatesInspector spec={spec} cursor={cursor} view={view} />
        </div>
      </div>

      <div className="flex flex-none flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <StatusIndicator status={cursor.snapshot.status} />
          <span className="text-muted-foreground tabular-nums">
            units={cursor.snapshot.units} · due={formatCents(cursor.snapshot.due)} · paid=
            {formatCents(cursor.snapshot.paid)}
          </span>
          <span aria-hidden className="hidden h-3.5 w-px bg-border sm:inline-block" />
          <div className="flex flex-wrap items-center gap-1">
            {view.transitions
              .filter((item) => item.enabled)
              .map(({ spec: t }) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => triggerTransition(t.id)}
                  className={cn(
                    focusRing,
                    "rounded-sm border border-primary/40 bg-card px-2 py-0.5 font-mono text-xs font-medium text-primary transition-colors duration-fast hover:bg-accent",
                  )}
                >
                  {t.label}
                </button>
              ))}
          </div>
        </div>

        <ol aria-label="Verification stages" className="hidden items-center gap-3 text-xs md:flex">
          {CHECK_STAGES.map((stage) => (
            <li key={stage} className="flex items-center gap-1 font-mono text-muted-foreground">
              <span aria-hidden className="font-semibold text-ok">
                ✓
              </span>
              {stage}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
