import { useState } from "react";
import { Button, cn, focusRing } from "@repo/ui";
import { StackFooter } from "./StackFooter.tsx";
import { StudioWindow } from "./StudioWindow.tsx";
import {
  AGENT_LAUNCHERS,
  AGENT_PROMPTS,
  GITHUB_URL,
  ORDER_SPEC,
  SKILL_URL,
  type AgentLauncherId,
  type PromptModeId,
  type ThemeChoice,
} from "./studioData.ts";

function VibestackLogo({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      className={cn("size-7 flex-none", className)}
    >
      <path d="M3 5H7L16 14L25 5H29L16 18Z" className="fill-primary" />
      <path
        d="M3.5 11.5H7L16 20.5L25 11.5H28.5L16 24Z"
        className="fill-primary opacity-70"
      />
      <path
        d="M4 18H7.5L16 26.5L24.5 18H28L16 30Z"
        className="fill-primary opacity-40"
      />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-4 fill-current">
      <path d="M8 0.2A7.8 7.8 0 0 0 5.53 15.4c.39.07.53-.17.53-.38v-1.33c-2.17.47-2.63-1.05-2.63-1.05-.36-.9-.87-1.14-.87-1.14-.7-.48.05-.47.05-.47.78.05 1.19.8 1.19.8.7 1.19 1.82.85 2.27.65.07-.5.27-.85.5-1.04-1.73-.2-3.56-.87-3.56-3.86 0-.85.3-1.55.8-2.1-.08-.2-.35-.99.08-2.06 0 0 .66-.21 2.15.8a7.44 7.44 0 0 1 3.92 0c1.49-1.01 2.14-.8 2.14-.8.43 1.07.16 1.86.08 2.06.5.55.8 1.25.8 2.1 0 3-1.83 3.66-3.57 3.85.28.24.53.72.53 1.45v2.15c0 .21.14.46.54.38A7.8 7.8 0 0 0 8 0.2Z" />
    </svg>
  );
}

function StarMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="size-3.5 fill-none stroke-current"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1.8l1.85 3.75 4.15.6-3 2.92.71 4.13L8 11.25 4.29 13.2 5 9.07 2 6.15l4.15-.6L8 1.8Z" />
    </svg>
  );
}

function ThemeMark({ dark }: { readonly dark: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="size-4 fill-none stroke-current"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {dark ? (
        <path d="M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6ZM8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1" />
      ) : (
        <path d="M12.8 9.8A5.2 5.2 0 0 1 6.2 3.2a5.2 5.2 0 1 0 6.6 6.6Z" />
      )}
    </svg>
  );
}

function CopyMark({ copied }: { readonly copied: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="size-3.5 fill-none stroke-current"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {copied ? (
        <path d="M3.2 8.4 6.4 11.6 12.8 4.6" />
      ) : (
        <path d="M5.5 5.5h7v7h-7zM3.5 10.5v-7h7" />
      )}
    </svg>
  );
}

function AgentMark({ id }: { readonly id: AgentLauncherId }) {
  switch (id) {
    case "chatgpt":
      return (
        <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3.5a4.2 4.2 0 0 1 3.9 2.6 4.2 4.2 0 0 1 3.7 5.7 4.2 4.2 0 0 1-1.7 6.3 4.2 4.2 0 0 1-6.9 1.6 4.2 4.2 0 0 1-6.5-2.6 4.2 4.2 0 0 1 1.1-6.6A4.2 4.2 0 0 1 12 3.5Z" />
          <circle cx="12" cy="12" r="2.8" />
        </svg>
      );
    case "claude":
      return (
        <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round">
          <path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6 6 18" />
        </svg>
      );
    case "grok":
      return (
        <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="7.5" />
          <path d="M6.5 17.5 18 6" />
        </svg>
      );
    case "cursor":
      return (
        <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current" strokeWidth={1.8} strokeLinejoin="round">
          <path d="M12 3 20 7.6v8.8L12 21l-8-4.6V7.6L12 3Z" />
          <path d="M12 12 20 7.6M12 12v9M12 12 4 7.6" />
        </svg>
      );
    case "muse":
      return (
        <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 16.5c0-3.2 2-6.5 4.2-6.5 1.8 0 2.9 1.7 3.8 3.2.9-1.5 2-3.2 3.8-3.2 2.2 0 4.2 3.3 4.2 6.5" />
          <circle cx="12" cy="6.5" r="1.6" className="fill-current stroke-none" />
        </svg>
      );
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export function App() {
  const [modeId, setModeId] = useState<PromptModeId>("new");
  const [copiedMode, setCopiedMode] = useState<PromptModeId | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );

  const activePrompt =
    AGENT_PROMPTS.find((item) => item.id === modeId) ?? AGENT_PROMPTS[0];
  const isCopied = copiedMode === activePrompt.id;
  const isDark = theme === "dark";

  const toggleTheme = () => {
    const next: ThemeChoice = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.classList.toggle("light", next === "light");
    setTheme(next);
  };

  const selectMode = (id: PromptModeId) => {
    setModeId(id);
    setCopiedMode(null);
  };

  const copyPrompt = () => {
    void navigator.clipboard?.writeText(activePrompt.prompt);
    setCopiedMode(activePrompt.id);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-6">
        <div className="flex items-center gap-2.5">
          <VibestackLogo />
          <span className="text-base font-semibold tracking-tight text-foreground">
            vibestack
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="size-9"
            aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
            onClick={toggleTheme}
          >
            <ThemeMark dark={isDark} />
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Star Vibestack on GitHub"
            >
              <GitHubMark />
              <StarMark />
              Star on GitHub
            </a>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6">
        <section className="flex flex-col items-center pt-14 pb-20 text-center sm:pt-20 sm:pb-24">
          <div
            role="tablist"
            aria-label="Project mode"
            className="mb-8 inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm"
          >
            {AGENT_PROMPTS.map((item) => {
              const active = item.id === activePrompt.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => selectMode(item.id)}
                  className={cn(
                    focusRing,
                    "rounded-md px-4 py-1.5 text-xs font-medium transition-colors duration-fast sm:text-sm",
                    active
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Ship apps. Not slop.
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Build formally verified full-stack applications in English.
            <br />
            What you want is what you get.
          </p>

          <div className="mt-10 flex w-full max-w-3xl flex-col items-center gap-4">
            <span className="text-sm font-medium text-muted-foreground">
              Paste into your agent.
            </span>

            <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card p-2 pl-4 text-left shadow-sm sm:pl-5">
              <output
                aria-label="Agent prompt"
                className="min-w-0 flex-1 overflow-x-auto font-mono text-xs leading-relaxed text-foreground sm:text-sm"
              >
                <code className="whitespace-nowrap">
                  Read{" "}
                  <a
                    href="/SKILL.md"
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      focusRing,
                      "rounded-sm text-primary underline-offset-4 hover:underline",
                    )}
                  >
                    {SKILL_URL.replace(/^https:\/\//, "")}
                  </a>{" "}
                  {activePrompt.suffix}
                </code>
              </output>

              <Button
                size="md"
                variant="primary"
                aria-label={isCopied ? "Copied agent prompt" : "Copy agent prompt"}
                onClick={copyPrompt}
                className="flex-none"
              >
                <CopyMark copied={isCopied} />
                {isCopied ? "Copied" : "Copy"}
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <span className="mr-1 text-xs text-muted-foreground">Open in</span>
              {AGENT_LAUNCHERS.map((launcher) => (
                <a
                  key={launcher.id}
                  href={launcher.buildUrl(activePrompt.prompt)}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    focusRing,
                    "inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors duration-fast hover:border-primary hover:text-primary",
                  )}
                >
                  <AgentMark id={launcher.id} />
                  <span>{launcher.label}</span>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className="pb-20">
          <StudioWindow spec={ORDER_SPEC} />
        </section>
      </main>

      <StackFooter />
    </div>
  );
}
