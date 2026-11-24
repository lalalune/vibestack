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

const AGENT_FILL_PATHS: Readonly<Record<Exclude<AgentLauncherId, "muse">, string>> = {
  chatgpt:
    "M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z",
  claude:
    "M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z",
  grok:
    "M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815",
  cursor:
    "M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z",
};

function AgentMark({ id }: { readonly id: AgentLauncherId }) {
  if (id === "muse") {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="size-5 flex-none fill-none stroke-current"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M1.4 10.8C3.2 7.6 5.2 4.9 6.0 5.1C6.6 5.3 4.3 18.3 4.8 18.7C5.4 19.1 10.6 6.2 12.2 6.3C13.1 6.4 11.1 18.3 11.6 18.7C12.2 19.1 16.7 8.7 18.1 8.8C19.0 8.9 17.3 18.4 18.0 18.9C18.8 19.4 21.1 16.0 22.6 13.4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5 flex-none fill-current">
      <path fillRule="evenodd" d={AGENT_FILL_PATHS[id]} />
    </svg>
  );
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
        <section className="flex flex-col items-center pt-16 pb-20 text-center sm:pt-24 sm:pb-24">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Ship apps. Not slop.
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Build formally verified full-stack applications in English.
            <br />
            What you want is what you get.
          </p>

          <div className="mt-12 flex w-full max-w-3xl flex-col items-center gap-4">
            <div
              role="tablist"
              aria-label="Project mode"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm"
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
                  title={launcher.label}
                  aria-label={`Open in ${launcher.label}`}
                  target={launcher.external ? "_blank" : undefined}
                  rel={launcher.external ? "noreferrer" : undefined}
                  className={cn(
                    focusRing,
                    "grid size-10 place-items-center rounded-lg border border-border bg-card text-foreground transition-colors duration-fast hover:border-primary hover:text-primary",
                  )}
                >
                  <AgentMark id={launcher.id} />
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
