import type { ReactNode } from "react";
import { cn, focusRing } from "@repo/ui";
import { SHAW_URL } from "./studioData.ts";

interface StackLink {
  readonly name: string;
  readonly href: string;
  readonly icon: ReactNode;
}

const STACK_LINKS: readonly StackLink[] = [
  {
    name: "Quint",
    href: "https://quint-lang.org",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11.5" cy="11.5" r="7" />
        <path d="M14.5 14.5L20 20" />
      </svg>
    ),
  },
  {
    name: "Vibelang",
    href: "https://github.com/smithersai/vibelang",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6l8 13L20 6" />
        <path d="M8.5 6L12 12l3.5-6" />
      </svg>
    ),
  },
  {
    name: "Dafny",
    href: "https://dafny.org",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8 3.5v5.5c0 4.8-3.4 8-8 9-4.6-1-8-4.2-8-9V6.5L12 3Z" />
        <path d="M8.5 12.2l2.3 2.3 4.7-4.8" />
      </svg>
    ),
  },
  {
    name: "LemmaScript",
    href: "https://github.com/midspiral/LemmaScript",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 4v16" />
        <path d="M6 12h12" />
        <path d="M15 8.5l3.5 3.5-3.5 3.5" />
      </svg>
    ),
  },
  {
    name: "Bombadil",
    href: "https://github.com/antithesishq/bombadil",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M15.5 8.5l-2 5.2-5 1.8 2-5.2 5-1.8Z" />
      </svg>
    ),
  },
  {
    name: "Storybook",
    href: "https://storybook.js.org",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="4.5" y="3" width="15" height="18" rx="2" />
        <path d="M15.5 3v4l-1.5-1-1.5 1V3" />
        <path d="M9.5 15.2c.5.8 1.5 1.3 2.6 1.3 1.5 0 2.6-.8 2.6-2 0-1.1-.8-1.6-2.2-2l-.9-.2c-1.1-.3-1.8-.8-1.8-1.7 0-1 .9-1.7 2.2-1.7 1 0 1.8.4 2.3 1" />
      </svg>
    ),
  },
  {
    name: "Effect.ts",
    href: "https://effect.website",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 6h12" />
        <path d="M6 12h9" />
        <path d="M6 18h12" />
        <path d="M6 6v12" />
      </svg>
    ),
  },
  {
    name: "React",
    href: "https://react.dev",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current" strokeWidth={1.6}>
        <circle cx="12" cy="12" r="1.8" className="fill-current stroke-none" />
        <ellipse cx="12" cy="12" rx="9.5" ry="3.8" />
        <ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(120 12 12)" />
      </svg>
    ),
  },
  {
    name: "Tailwind",
    href: "https://tailwindcss.com",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-current">
        <path d="M12 6c-2.67 0-4.33 1.33-5 4 1-1.33 2.17-1.83 3.5-1.5.76.19 1.3.74 1.9 1.35C13.38 10.84 14.52 12 17 12c2.67 0 4.33-1.33 5-4-1 1.33-2.17 1.83-3.5 1.5-.76-.19-1.3-.74-1.9-1.35C15.62 7.16 14.48 6 12 6ZM7 12c-2.67 0-4.33 1.33-5 4 1-1.33 2.17-1.83 3.5-1.5.76.19 1.3.74 1.9 1.35C8.38 16.84 9.52 18 12 18c2.67 0 4.33-1.33 5-4-1 1.33-2.17 1.83-3.5 1.5-.76-.19-1.3-.74-1.9-1.35C10.62 13.16 9.48 12 7 12Z" />
      </svg>
    ),
  },
  {
    name: "shadcn/ui",
    href: "https://ui.shadcn.com",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round">
        <path d="M19 5L5 19" />
        <path d="M19 13l-6 6" />
      </svg>
    ),
  },
  {
    name: "ESLint",
    href: "https://eslint.org",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current" strokeWidth={1.8} strokeLinejoin="round">
        <path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4l8-4.6Z" />
        <path d="M12 7.6l3.8 2.2v4.4L12 16.4l-3.8-2.2V9.8L12 7.6Z" />
      </svg>
    ),
  },
];

export function StackFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-6 py-10">
        <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
          {STACK_LINKS.map((item) => (
            <a
              key={item.name}
              href={item.href}
              target="_blank"
              rel="noreferrer"
              className={cn(
                focusRing,
                "inline-flex items-center gap-2 rounded-sm text-xs font-medium text-muted-foreground transition-colors duration-fast hover:text-foreground",
              )}
            >
              {item.icon}
              <span>{item.name}</span>
            </a>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Made by{" "}
          <a
            href={SHAW_URL}
            target="_blank"
            rel="noreferrer"
            className={cn(
              focusRing,
              "rounded-sm font-medium text-foreground underline-offset-4 transition-colors duration-fast hover:text-primary hover:underline",
            )}
          >
            Shaw
          </a>
        </p>
      </div>
    </footer>
  );
}
