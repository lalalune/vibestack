import { useId } from "react";
import { cn } from "@repo/ui";
import type {
  SpecRegistry,
  StateId,
  StateSpec,
  StudioProjection,
  TransitionId,
  TransitionSpec,
} from "./studioData.ts";

interface NodeBox {
  readonly id: StateId;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface EdgeRoute {
  readonly id: TransitionId;
  readonly path: string;
  readonly pillX: number;
  readonly pillY: number;
  readonly pillW: number;
}

const NODE_W = 156;
const NODE_H = 74;

const NODE_POSITIONS: Readonly<Record<StateId, NodeBox>> = {
  Draft: { id: "Draft", x: 54, y: 74, w: NODE_W, h: NODE_H },
  Pending: { id: "Pending", x: 322, y: 74, w: NODE_W, h: NODE_H },
  OnHold: { id: "OnHold", x: 322, y: 216, w: NODE_W, h: NODE_H },
  Paid: { id: "Paid", x: 590, y: 74, w: NODE_W, h: NODE_H },
};

const EDGE_ROUTES: readonly EdgeRoute[] = [
  {
    id: "addItem",
    path: "M 102,71 C 102,18 162,18 162,68",
    pillX: 132,
    pillY: 28,
    pillW: 94,
  },
  {
    id: "submit",
    path: "M 210,111 L 315,111",
    pillX: 263,
    pillY: 111,
    pillW: 76,
  },
  {
    id: "pay",
    path: "M 478,111 L 583,111",
    pillX: 531,
    pillY: 111,
    pillW: 72,
  },
  {
    id: "hold",
    path: "M 366,148 C 344,174 344,190 366,210",
    pillX: 306,
    pillY: 182,
    pillW: 74,
  },
  {
    id: "release",
    path: "M 434,216 C 456,190 456,174 434,154",
    pillX: 494,
    pillY: 182,
    pillW: 82,
  },
];

function GraphStateNode({
  box,
  stateSpec,
  isActive,
  isHighlighted,
  onSelect,
}: {
  readonly box: NodeBox;
  readonly stateSpec: StateSpec;
  readonly isActive: boolean;
  readonly isHighlighted: boolean;
  readonly onSelect: (id: StateId) => void;
}) {
  const isGoal = Boolean(stateSpec.goal);
  const frameClass = isActive || isHighlighted
    ? "fill-card stroke-primary"
    : isGoal
      ? "fill-card stroke-ok"
      : "fill-card stroke-border";

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`State ${stateSpec.label}`}
      className="cursor-pointer outline-none"
      onClick={() => onSelect(stateSpec.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(stateSpec.id);
        }
      }}
    >
      {isActive && (
        <rect
          x={box.x - 4}
          y={box.y - 4}
          width={box.w + 8}
          height={box.h + 8}
          rx={12}
          fill="none"
          strokeWidth={3}
          className="stroke-primary/25"
        />
      )}
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={9}
        strokeWidth={isActive || isHighlighted ? 2 : 1.25}
        className={cn(frameClass, "transition-colors duration-fast")}
      />
      <text
        x={box.x + 12}
        y={box.y + 24}
        fontSize={13}
        className="fill-foreground font-sans font-semibold"
      >
        {stateSpec.label}
      </text>
      {isActive ? (
        <text
          x={box.x + box.w - 12}
          y={box.y + 23}
          textAnchor="end"
          fontSize={10}
          className="fill-primary font-mono font-medium"
        >
          ● live
        </text>
      ) : stateSpec.initial ? (
        <text
          x={box.x + box.w - 12}
          y={box.y + 23}
          textAnchor="end"
          fontSize={10}
          className="fill-muted-foreground font-mono"
        >
          init
        </text>
      ) : isGoal ? (
        <text
          x={box.x + box.w - 12}
          y={box.y + 23}
          textAnchor="end"
          fontSize={10}
          className="fill-ok font-mono"
        >
          ⚑ goal
        </text>
      ) : null}
      {stateSpec.invariantLines.map((line, index) => (
        <text
          key={line}
          x={box.x + 12}
          y={box.y + 44 + index * 16}
          fontSize={10.5}
          className="fill-muted-foreground font-mono"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function GraphEdgePill({
  route,
  edge,
  highlighted,
  enabled,
  onTrigger,
}: {
  readonly route: EdgeRoute;
  readonly edge: TransitionSpec;
  readonly highlighted: boolean;
  readonly enabled: boolean;
  readonly onTrigger: (id: TransitionId) => void;
}) {
  const isGoalEdge = Boolean(edge.liveness);
  const pillBg = highlighted
    ? "fill-accent stroke-primary"
    : enabled
      ? isGoalEdge
        ? "fill-card stroke-ok"
        : "fill-card stroke-primary"
      : "fill-background stroke-border";
  const pillText = highlighted
    ? "fill-primary font-semibold"
    : enabled
      ? isGoalEdge
        ? "fill-ok font-semibold"
        : "fill-primary font-medium"
      : "fill-muted-foreground";

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${edge.label} (${edge.sender})`}
      className="cursor-pointer outline-none"
      onClick={() => onTrigger(route.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTrigger(route.id);
        }
      }}
    >
      <rect
        x={route.pillX - route.pillW / 2}
        y={route.pillY - 12}
        width={route.pillW}
        height={24}
        rx={6}
        strokeWidth={highlighted || enabled ? 1.5 : 1}
        className={cn(pillBg, "transition-colors duration-fast")}
      />
      <text
        x={route.pillX}
        y={route.pillY + 4}
        textAnchor="middle"
        fontSize={11}
        className={cn("font-mono", pillText)}
      >
        {edge.label}
      </text>
    </g>
  );
}

export interface StateCanvasProps {
  readonly spec: SpecRegistry;
  readonly view: StudioProjection;
  readonly onSelectState: (stateId: StateId) => void;
  readonly onTriggerTransition: (transitionId: TransitionId) => void;
}

export function StateCanvas({
  spec,
  view,
  onSelectState,
  onTriggerTransition,
}: StateCanvasProps) {
  const uid = useId().replace(/:/g, "");
  const enabledSet = new Set(
    view.transitions.filter((item) => item.enabled).map((item) => item.spec.id),
  );

  return (
    <svg
      viewBox="0 0 800 314"
      role="img"
      aria-label={`${spec.stateType} state graph`}
      className="h-full w-full select-none"
    >
      <defs>
        <pattern id={`${uid}-grid`} width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1" className="fill-border" opacity={0.7} />
        </pattern>
        <marker
          id={`${uid}-m-base`}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6.5"
          markerHeight="6.5"
          orient="auto-start-reverse"
        >
          <path d="M 1 1.5 L 9 5 L 1 8.5 z" className="fill-input" />
        </marker>
        <marker
          id={`${uid}-m-active`}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 1 1.5 L 9 5 L 1 8.5 z" className="fill-primary" />
        </marker>
        <marker
          id={`${uid}-m-goal`}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6.5"
          markerHeight="6.5"
          orient="auto-start-reverse"
        >
          <path d="M 1 1.5 L 9 5 L 1 8.5 z" className="fill-ok" />
        </marker>
      </defs>

      <rect x={0} y={0} width={800} height={314} fill={`url(#${uid}-grid)`} />

      <g aria-label="Initial state">
        <circle cx={20} cy={111} r={4.5} className="fill-primary" />
        <path
          d="M 26,111 L 47,111"
          fill="none"
          strokeWidth={1.75}
          className="stroke-primary"
          markerEnd={`url(#${uid}-m-active)`}
        />
      </g>

      {EDGE_ROUTES.map((route) => {
        const edge = spec.transitions[route.id];
        const highlighted = view.highlightedTransitions.has(route.id);
        const enabled = enabledSet.has(route.id);
        const isGoalEdge = Boolean(edge.liveness);
        const strokeClass = highlighted
          ? "stroke-primary"
          : enabled
            ? isGoalEdge
              ? "stroke-ok"
              : "stroke-primary"
            : "stroke-input";
        const marker = highlighted
          ? `url(#${uid}-m-active)`
          : enabled
            ? isGoalEdge
              ? `url(#${uid}-m-goal)`
              : `url(#${uid}-m-active)`
            : `url(#${uid}-m-base)`;

        return (
          <path
            key={route.id}
            d={route.path}
            fill="none"
            strokeWidth={highlighted || enabled ? 2 : 1.4}
            strokeDasharray={enabled || highlighted ? undefined : "4 4"}
            className={cn(strokeClass, "transition-colors duration-fast")}
            markerEnd={marker}
          />
        );
      })}

      {spec.stateOrder.map((stateId) => (
        <GraphStateNode
          key={stateId}
          box={NODE_POSITIONS[stateId]}
          stateSpec={spec.states[stateId]}
          isActive={view.activeState === stateId}
          isHighlighted={view.highlightedStates.has(stateId)}
          onSelect={onSelectState}
        />
      ))}

      {EDGE_ROUTES.map((route) => (
        <GraphEdgePill
          key={`${route.id}-pill`}
          route={route}
          edge={spec.transitions[route.id]}
          highlighted={view.highlightedTransitions.has(route.id)}
          enabled={enabledSet.has(route.id)}
          onTrigger={onTriggerTransition}
        />
      ))}
    </svg>
  );
}
