export const GITHUB_URL = "https://github.com/lalalune/vibestack";
export const SKILL_URL = "https://vibestack.fun/SKILL.md";
export const SHAW_URL = "https://x.com/shawmakesmagic";
export const UNIT_PRICE = 5;
export const MAX_UNITS = 60;

export type StateId = "Draft" | "Pending" | "OnHold" | "Paid";
export type TransitionId = "addItem" | "submit" | "hold" | "release" | "pay";
export type ControlId = "add-unit" | "submit-order" | "toggle-hold" | "pay-balance";
export type LayoutPartId = "OrderCheckout" | "BalanceMeter" | "ActionBar";
export type RuleId = "r-add" | "r-submit" | "r-hold" | "r-release" | "r-pay" | "r-due" | "r-paid" | "r-pending";
export type StoryId = "fill-draft" | "checkout" | "hold-order";
export type PromptModeId = "new" | "existing";
export type AgentLauncherId = "chatgpt" | "claude" | "grok" | "cursor" | "muse";
export type DensityMode = "prose" | "quint";
export type ThemeChoice = "light" | "dark";
export type ActorRole = "Shopper" | "Staff";

export interface ModelSnapshot {
  readonly status: StateId;
  readonly units: number;
  readonly due: number;
  readonly paid: number;
  readonly stepCount: number;
  readonly lastTransition: TransitionId | null;
}

export interface StateSpec {
  readonly id: StateId;
  readonly label: string;
  readonly initial?: true;
  readonly goal?: true;
  readonly invariantLines: readonly string[];
  readonly rules: readonly RuleId[];
}

export interface TransitionSpec {
  readonly id: TransitionId;
  readonly label: string;
  readonly from: StateId;
  readonly to: StateId;
  readonly sender: ActorRole;
  readonly quint: string;
  readonly ruleId: RuleId;
  readonly storyId: StoryId;
  readonly controlId: ControlId;
  readonly liveness?: true;
  readonly canFire: (snapshot: ModelSnapshot) => boolean;
  readonly apply: (snapshot: ModelSnapshot) => ModelSnapshot;
}

export interface RuleSpec {
  readonly id: RuleId;
  readonly storyId: StoryId;
  readonly kind: "transition" | "always" | "sometimes";
  readonly heading: string;
  readonly quint: string;
  readonly states: readonly StateId[];
  readonly transitions: readonly TransitionId[];
  readonly check?: (snapshot: ModelSnapshot) => boolean;
}

export interface StorySpec {
  readonly id: StoryId;
  readonly title: string;
  readonly rules: readonly RuleId[];
}

export interface LayoutPartSpec {
  readonly id: LayoutPartId;
  readonly transitions: readonly TransitionId[];
}

export interface PreviewControlSpec {
  readonly id: ControlId;
  readonly label: (snapshot: ModelSnapshot) => string;
  readonly variant: "primary" | "secondary" | "outline";
  readonly transitions: readonly TransitionId[];
}

export interface AgentPromptOption {
  readonly id: PromptModeId;
  readonly label: string;
  readonly suffix: string;
  readonly prompt: string;
}

export interface AgentLauncher {
  readonly id: AgentLauncherId;
  readonly label: string;
  readonly external: boolean;
  readonly buildUrl: (prompt: string) => string;
}

export interface SpecRegistry {
  readonly projectName: string;
  readonly moduleName: string;
  readonly stateType: string;
  readonly initial: ModelSnapshot;
  readonly stateOrder: readonly StateId[];
  readonly states: Readonly<Record<StateId, StateSpec>>;
  readonly transitionOrder: readonly TransitionId[];
  readonly transitions: Readonly<Record<TransitionId, TransitionSpec>>;
  readonly storyOrder: readonly StoryId[];
  readonly stories: Readonly<Record<StoryId, StorySpec>>;
  readonly ruleOrder: readonly RuleId[];
  readonly rules: Readonly<Record<RuleId, RuleSpec>>;
  readonly partOrder: readonly LayoutPartId[];
  readonly parts: Readonly<Record<LayoutPartId, LayoutPartSpec>>;
  readonly controlOrder: readonly ControlId[];
  readonly controls: Readonly<Record<ControlId, PreviewControlSpec>>;
}

export type StudioFocus =
  | { readonly kind: "none" }
  | { readonly kind: "state"; readonly stateId: StateId }
  | { readonly kind: "transition"; readonly transitionId: TransitionId }
  | { readonly kind: "part"; readonly partId: LayoutPartId }
  | { readonly kind: "control"; readonly controlId: ControlId }
  | { readonly kind: "rule"; readonly ruleId: RuleId };

export interface StudioCursor {
  readonly snapshot: ModelSnapshot;
  readonly focus: StudioFocus;
  readonly density: DensityMode;
  readonly inspect: boolean;
}

export interface TransitionAvailability {
  readonly spec: TransitionSpec;
  readonly enabled: boolean;
}

export interface InvariantStatus {
  readonly rule: RuleSpec;
  readonly holds: boolean;
}

export interface StudioProjection {
  readonly activeState: StateId;
  readonly paidRatio: number;
  readonly highlightedStates: ReadonlySet<StateId>;
  readonly highlightedTransitions: ReadonlySet<TransitionId>;
  readonly highlightedControls: ReadonlySet<ControlId>;
  readonly highlightedRules: ReadonlySet<RuleId>;
  readonly highlightedPart: LayoutPartId | null;
  readonly transitions: readonly TransitionAvailability[];
  readonly invariants: readonly InvariantStatus[];
  readonly isInitial: boolean;
}

export const AGENT_PROMPTS: readonly AgentPromptOption[] = [
  {
    id: "new",
    label: "New Project",
    suffix: "and create a new project.",
    prompt: `Read ${SKILL_URL} and create a new project.`,
  },
  {
    id: "existing",
    label: "Existing Project",
    suffix: "and upgrade an existing project.",
    prompt: `Read ${SKILL_URL} and upgrade an existing project.`,
  },
];

export const AGENT_LAUNCHERS: readonly AgentLauncher[] = [
  {
    id: "chatgpt",
    label: "ChatGPT (Codex)",
    external: false,
    buildUrl: (prompt) => `codex://new?prompt=${encodeURIComponent(prompt)}`,
  },
  {
    id: "claude",
    label: "Claude Code",
    external: false,
    buildUrl: (prompt) => `claude://code/new?q=${encodeURIComponent(prompt)}`,
  },
  {
    id: "grok",
    label: "Grok Bot",
    external: false,
    buildUrl: (prompt) => `grokbot://app/v1/prompt?text=${encodeURIComponent(prompt)}`,
  },
  {
    id: "cursor",
    label: "Cursor",
    external: false,
    buildUrl: (prompt) =>
      `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(prompt)}`,
  },
  {
    id: "muse",
    label: "Muse",
    external: true,
    buildUrl: (prompt) => `https://www.meta.ai/?prompt=${encodeURIComponent(prompt)}`,
  },
];

export const PIPELINE_STEPS = ["Edit", "Publish", "Sync", "Check", "Sign off"] as const;
export const CHECK_STAGES = ["model", "replay", "proof", "tests"] as const;

const INITIAL_SNAPSHOT: ModelSnapshot = {
  status: "Draft",
  units: 2,
  due: 10,
  paid: 0,
  stepCount: 0,
  lastTransition: null,
};

export const ORDER_SPEC: SpecRegistry = {
  projectName: "order",
  moduleName: "order",
  stateType: "Order",
  initial: INITIAL_SNAPSHOT,
  stateOrder: ["Draft", "Pending", "OnHold", "Paid"],
  states: {
    Draft: {
      id: "Draft",
      label: "Draft",
      initial: true,
      invariantLines: ["due == units * 5", "paid == 0"],
      rules: ["r-add", "r-submit", "r-due"],
    },
    Pending: {
      id: "Pending",
      label: "Pending",
      invariantLines: ["paid < due", "units > 0"],
      rules: ["r-pay", "r-hold", "r-paid", "r-pending"],
    },
    OnHold: {
      id: "OnHold",
      label: "OnHold",
      invariantLines: ["0 <= paid <= due"],
      rules: ["r-hold", "r-release", "r-paid"],
    },
    Paid: {
      id: "Paid",
      label: "Paid",
      goal: true,
      invariantLines: ["paid == due", "due > 0"],
      rules: ["r-pay", "r-paid"],
    },
  },
  transitionOrder: ["addItem", "submit", "hold", "release", "pay"],
  transitions: {
    addItem: {
      id: "addItem",
      label: "addItem",
      from: "Draft",
      to: "Draft",
      sender: "Shopper",
      quint: `pure def canAddItem(o: Order, qty: int, by: Role): bool =
  by == Shopper and o.status == Draft and qty > 0 and o.units + qty <= maxUnits

pure def addItem(o: Order, qty: int, by: Role): Order =
  { ...o, units: o.units + qty, due: o.due + qty * unitPrice }`,
      ruleId: "r-add",
      storyId: "fill-draft",
      controlId: "add-unit",
      canFire: (s) => s.status === "Draft" && s.units < MAX_UNITS,
      apply: (s) => ({
        ...s,
        units: s.units + 1,
        due: s.due + UNIT_PRICE,
        stepCount: s.stepCount + 1,
        lastTransition: "addItem",
      }),
    },
    submit: {
      id: "submit",
      label: "submit",
      from: "Draft",
      to: "Pending",
      sender: "Shopper",
      quint: `pure def canSubmit(o: Order, by: Role): bool =
  by == Shopper and o.status == Draft and o.units > 0

pure def submit(o: Order, by: Role): Order =
  { ...o, status: Pending }`,
      ruleId: "r-submit",
      storyId: "checkout",
      controlId: "submit-order",
      canFire: (s) => s.status === "Draft" && s.units > 0,
      apply: (s) => ({
        ...s,
        status: "Pending",
        stepCount: s.stepCount + 1,
        lastTransition: "submit",
      }),
    },
    hold: {
      id: "hold",
      label: "hold",
      from: "Pending",
      to: "OnHold",
      sender: "Staff",
      quint: `pure def canHold(o: Order, by: Role): bool =
  by == Staff and o.status == Pending

pure def hold(o: Order, by: Role): Order =
  { ...o, status: OnHold }`,
      ruleId: "r-hold",
      storyId: "hold-order",
      controlId: "toggle-hold",
      canFire: (s) => s.status === "Pending",
      apply: (s) => ({
        ...s,
        status: "OnHold",
        stepCount: s.stepCount + 1,
        lastTransition: "hold",
      }),
    },
    release: {
      id: "release",
      label: "release",
      from: "OnHold",
      to: "Pending",
      sender: "Staff",
      quint: `pure def canRelease(o: Order, by: Role): bool =
  by == Staff and o.status == OnHold

pure def release(o: Order, by: Role): Order =
  { ...o, status: Pending }`,
      ruleId: "r-release",
      storyId: "hold-order",
      controlId: "toggle-hold",
      canFire: (s) => s.status === "OnHold",
      apply: (s) => ({
        ...s,
        status: "Pending",
        stepCount: s.stepCount + 1,
        lastTransition: "release",
      }),
    },
    pay: {
      id: "pay",
      label: "pay",
      from: "Pending",
      to: "Paid",
      sender: "Shopper",
      quint: `pure def canPay(o: Order, amount: int, by: Role): bool =
  by == Shopper and o.status == Pending and amount > 0 and o.paid + amount <= o.due

pure def pay(o: Order, amount: int, by: Role): Order =
  val paid = o.paid + amount
  { ...o, paid: paid, status: if (paid == o.due) Paid else Pending }`,
      ruleId: "r-pay",
      storyId: "checkout",
      controlId: "pay-balance",
      liveness: true,
      canFire: (s) => s.status === "Pending" && s.paid < s.due,
      apply: (s) => {
        const nextPaid = Math.min(s.due, s.paid + UNIT_PRICE);
        return {
          ...s,
          paid: nextPaid,
          status: nextPaid === s.due ? "Paid" : "Pending",
          stepCount: s.stepCount + 1,
          lastTransition: "pay",
        };
      },
    },
  },
  storyOrder: ["fill-draft", "checkout", "hold-order"],
  stories: {
    "fill-draft": {
      id: "fill-draft",
      title: "Story: Fill a draft",
      rules: ["r-add", "r-due"],
    },
    checkout: {
      id: "checkout",
      title: "Story: Check out",
      rules: ["r-submit", "r-pay", "r-paid", "r-pending"],
    },
    "hold-order": {
      id: "hold-order",
      title: "Story: Hold an order",
      rules: ["r-hold", "r-release"],
    },
  },
  ruleOrder: ["r-add", "r-due", "r-submit", "r-pay", "r-paid", "r-pending", "r-hold", "r-release"],
  rules: {
    "r-add": {
      id: "r-add",
      storyId: "fill-draft",
      kind: "transition",
      heading: "Items can only be added to a draft",
      quint: "canAddItem(o, qty, by) = by == Shopper and o.status == Draft and o.units + qty <= maxUnits",
      states: ["Draft"],
      transitions: ["addItem"],
    },
    "r-due": {
      id: "r-due",
      storyId: "fill-draft",
      kind: "always",
      heading: "Amount due always matches unit price",
      quint: "alwaysDueMatchesUnits(o) = o.due == o.units * unitPrice",
      states: ["Draft", "Pending", "OnHold", "Paid"],
      transitions: ["addItem"],
      check: (s) => s.due === s.units * UNIT_PRICE,
    },
    "r-submit": {
      id: "r-submit",
      storyId: "checkout",
      kind: "transition",
      heading: "Only a non-empty draft can be submitted",
      quint: "canSubmit(o, by) = by == Shopper and o.status == Draft and o.units > 0",
      states: ["Draft", "Pending"],
      transitions: ["submit"],
    },
    "r-pay": {
      id: "r-pay",
      storyId: "checkout",
      kind: "sometimes",
      heading: "A payment never exceeds the balance",
      quint: "canPay(o, amount, by) = o.status == Pending and amount > 0 and o.paid + amount <= o.due",
      states: ["Pending", "Paid"],
      transitions: ["pay"],
    },
    "r-paid": {
      id: "r-paid",
      storyId: "checkout",
      kind: "always",
      heading: "Amount paid stays within due",
      quint: "alwaysPaidWithinDue(o) = 0 <= o.paid and o.paid <= o.due",
      states: ["Draft", "Pending", "OnHold", "Paid"],
      transitions: ["pay"],
      check: (s) => s.paid >= 0 && s.paid <= s.due,
    },
    "r-pending": {
      id: "r-pending",
      storyId: "checkout",
      kind: "always",
      heading: "A pending order still has a balance",
      quint: "alwaysPendingHasBalance(o) = o.status == Pending implies o.paid < o.due",
      states: ["Pending"],
      transitions: ["submit", "pay"],
      check: (s) => s.status !== "Pending" || s.paid < s.due,
    },
    "r-hold": {
      id: "r-hold",
      storyId: "hold-order",
      kind: "transition",
      heading: "Only staff can put a pending order on hold",
      quint: "canHold(o, by) = by == Staff and o.status == Pending",
      states: ["Pending", "OnHold"],
      transitions: ["hold"],
    },
    "r-release": {
      id: "r-release",
      storyId: "hold-order",
      kind: "transition",
      heading: "Only staff can release a held order",
      quint: "canRelease(o, by) = by == Staff and o.status == OnHold",
      states: ["OnHold", "Pending"],
      transitions: ["release"],
    },
  },
  partOrder: ["OrderCheckout", "BalanceMeter", "ActionBar"],
  parts: {
    OrderCheckout: {
      id: "OrderCheckout",
      transitions: ["addItem", "submit", "hold", "release", "pay"],
    },
    BalanceMeter: {
      id: "BalanceMeter",
      transitions: ["addItem", "pay"],
    },
    ActionBar: {
      id: "ActionBar",
      transitions: ["submit", "hold", "release", "pay"],
    },
  },
  controlOrder: ["add-unit", "submit-order", "pay-balance", "toggle-hold"],
  controls: {
    "add-unit": {
      id: "add-unit",
      label: () => "+1 unit",
      variant: "outline",
      transitions: ["addItem"],
    },
    "submit-order": {
      id: "submit-order",
      label: () => "Submit",
      variant: "primary",
      transitions: ["submit"],
    },
    "pay-balance": {
      id: "pay-balance",
      label: (s) => (s.due - s.paid <= UNIT_PRICE ? "Pay final" : "Pay 5¢"),
      variant: "primary",
      transitions: ["pay"],
    },
    "toggle-hold": {
      id: "toggle-hold",
      label: (s) => (s.status === "OnHold" ? "Release" : "Hold"),
      variant: "secondary",
      transitions: ["hold", "release"],
    },
  },
};

export function initialCursor(spec: SpecRegistry): StudioCursor {
  return {
    snapshot: spec.initial,
    focus: { kind: "none" },
    density: "prose",
    inspect: true,
  };
}

export function stepCursor(spec: SpecRegistry, cursor: StudioCursor, id: TransitionId): StudioCursor {
  const transition = spec.transitions[id];
  if (!transition.canFire(cursor.snapshot)) {
    return { ...cursor, focus: { kind: "transition", transitionId: id } };
  }
  return {
    ...cursor,
    snapshot: transition.apply(cursor.snapshot),
    focus: { kind: "transition", transitionId: id },
  };
}

export function resetCursor(spec: SpecRegistry, cursor: StudioCursor): StudioCursor {
  return {
    ...cursor,
    snapshot: spec.initial,
    focus: { kind: "none" },
  };
}

export function formatCents(cents: number): string {
  return `${cents}¢`;
}

export function resolveControlTransition(
  spec: SpecRegistry,
  controlId: ControlId,
  snapshot: ModelSnapshot,
): TransitionSpec {
  const control = spec.controls[controlId];
  for (const tid of control.transitions) {
    const candidate = spec.transitions[tid];
    if (candidate.canFire(snapshot)) return candidate;
  }
  return spec.transitions[control.transitions[0]];
}

export function projectStudio(spec: SpecRegistry, cursor: StudioCursor): StudioProjection {
  const { snapshot, focus } = cursor;
  const highlightedStates = new Set<StateId>();
  const highlightedTransitions = new Set<TransitionId>();
  const highlightedControls = new Set<ControlId>();
  const highlightedRules = new Set<RuleId>();
  let highlightedPart: LayoutPartId | null = null;

  switch (focus.kind) {
    case "none":
      break;
    case "state": {
      const state = spec.states[focus.stateId];
      highlightedStates.add(state.id);
      for (const r of state.rules) highlightedRules.add(r);
      for (const tid of spec.transitionOrder) {
        const t = spec.transitions[tid];
        if (t.from === state.id || t.to === state.id) {
          highlightedTransitions.add(t.id);
          highlightedControls.add(t.controlId);
        }
      }
      break;
    }
    case "transition": {
      const t = spec.transitions[focus.transitionId];
      highlightedTransitions.add(t.id);
      highlightedStates.add(t.from);
      highlightedStates.add(t.to);
      highlightedControls.add(t.controlId);
      highlightedRules.add(t.ruleId);
      break;
    }
    case "part": {
      highlightedPart = focus.partId;
      const part = spec.parts[focus.partId];
      for (const tid of part.transitions) {
        const t = spec.transitions[tid];
        highlightedTransitions.add(tid);
        highlightedControls.add(t.controlId);
        highlightedRules.add(t.ruleId);
      }
      break;
    }
    case "control": {
      highlightedControls.add(focus.controlId);
      const control = spec.controls[focus.controlId];
      for (const tid of control.transitions) {
        const t = spec.transitions[tid];
        highlightedTransitions.add(tid);
        highlightedStates.add(t.from);
        highlightedStates.add(t.to);
        highlightedRules.add(t.ruleId);
      }
      break;
    }
    case "rule": {
      const rule = spec.rules[focus.ruleId];
      highlightedRules.add(rule.id);
      for (const s of rule.states) highlightedStates.add(s);
      for (const tid of rule.transitions) {
        highlightedTransitions.add(tid);
        highlightedControls.add(spec.transitions[tid].controlId);
      }
      break;
    }
    default: {
      const _exhaustive: never = focus;
      void _exhaustive;
    }
  }

  const transitions = spec.transitionOrder.map((tid) => {
    const t = spec.transitions[tid];
    return { spec: t, enabled: t.canFire(snapshot) };
  });

  const invariants = spec.ruleOrder.flatMap((rid) => {
    const rule = spec.rules[rid];
    return rule.check ? [{ rule, holds: rule.check(snapshot) }] : [];
  });

  const paidRatio = snapshot.due > 0 ? Math.round((snapshot.paid / snapshot.due) * 100) : 0;
  const isInitial =
    snapshot.status === spec.initial.status &&
    snapshot.units === spec.initial.units &&
    snapshot.paid === spec.initial.paid &&
    snapshot.stepCount === 0;

  return {
    activeState: snapshot.status,
    paidRatio,
    highlightedStates,
    highlightedTransitions,
    highlightedControls,
    highlightedRules,
    highlightedPart,
    transitions,
    invariants,
    isInitial,
  };
}
