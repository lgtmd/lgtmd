import { useTextReview } from "./use-text-review.ts";
import { TEXT_DIFF_VERSION } from "./text-diff.ts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { DocumentContent, pageHref } from "./content.tsx";
import type { Boot, SiteState } from "./protocol.ts";
import { RevisionReview } from "./revision-review.tsx";
import { History, RotateCw, X } from "lucide-react";
import { ThemeSelect } from "./theme.tsx";
import "./style.css";

const boot: Boot = window.__LGTMD__ ?? {
  mode: "dev",
  basePath: "./",
  dataUrl: "__lgtmd/state",
};
const base = new URL(boot.basePath, window.location.href);
const endpoint = (name: string) => new URL(`__lgtmd/${name}`, base).href;
function route() {
  try {
    const parts = window.location.hash
      .slice(1)
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
    return { page: parts[0], anchor: parts[1] };
  } catch {
    return {};
  }
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
async function jsonResponse(response: Response) {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed (${response.status}).`);
  }
  return response.json();
}
function App() {
  const [state, setState] = useState<SiteState>();
  const [failure, setFailure] = useState<string>();
  const [connected, setConnected] = useState(true);
  const [currentRoute, setRoute] = useState(route);
  const lastNavigation = useRef<{ page: string; anchor?: string }>(undefined);
  const [diff, setDiff] = useState(boot.mode === "review");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const historyClose = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!historyOpen) return;
    historyClose.current?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !historyRef.current?.contains(event.target) &&
        !historyButton.current?.contains(event.target)
      )
        setHistoryOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setHistoryOpen(false);
        historyButton.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [historyOpen]);
  const toolsRef = useRef<HTMLDivElement>(null);
  const toolsButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!toolsOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !toolsRef.current?.contains(event.target)
      ) {
        setToolsOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [toolsOpen]);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [currentRoute.page]);
  const [side, setSide] = useState<"previous" | "current">("current");
  const [changedOnly, setChangedOnly] = useState(boot.mode !== "review");
  const [selecting, setSelecting] = useState(false);
  const [running, setRunning] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    try {
      const next = (await jsonResponse(
        await fetch(new URL(boot.dataUrl, base), {
          cache: "no-store",
          credentials: "same-origin",
        }),
      )) as SiteState;
      if (ticket !== generation.current) return;
      setState(next);
      setFailure(undefined);
      setConnected(true);
    } catch (error) {
      if (ticket === generation.current) setFailure(errorText(error));
    }
  }, []);
  useEffect(() => {
    void refresh();
    if (boot.mode !== "dev") return;
    const events = new EventSource(endpoint("events"));
    events.onmessage = () => void refresh();
    events.onopen = () => {
      setConnected(true);
      void refresh();
    };
    events.onerror = () => setConnected(false);
    return () => {
      events.close();
      generation.current++;
    };
  }, [refresh]);
  useEffect(() => {
    const update = () => setRoute(route());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    if (state) document.title = `${state.title} · lgtmd`;
  }, [state?.title]);
  const current = state?.current;
  const previous = state?.baseline?.bundle;
  const comparison = state?.comparison;
  const allIds = [
    ...(current?.navigation ?? []),
    ...(diff ? (previous?.navigation ?? []) : []).filter(
      (id) => !current?.navigation.includes(id),
    ),
  ];
  const pageId =
    currentRoute.page && allIds.includes(currentRoute.page)
      ? currentRoute.page
      : allIds[0];
  const textPair = comparison?.pages.find((page) => page.id === pageId);
  const textReview = useTextReview(
    `${TEXT_DIFF_VERSION}:${state?.audience}:${comparison?.before}:${comparison?.after}:${pageId}`,
    diff && !!comparison,
    textPair?.before,
    textPair?.after,
  );
  const selectedBundle = diff && side === "previous" ? previous : current;
  const selectedPage = selectedBundle?.pages.find((p) => p.id === pageId);
  const hasTitle =
    selectedPage?.content.some(
      (node) => node.type === "heading" && node.level === 1,
    ) ?? false;
  const pageTitle =
    selectedPage?.title ??
    current?.pages.find((p) => p.id === pageId)?.title ??
    previous?.pages.find((p) => p.id === pageId)?.title ??
    "Documentation";
  const resourceBase =
    diff && side === "previous"
      ? (state?.baseline?.resourceBase ?? "")
      : (state?.currentResourceBase ?? "");
  const imagePairs =
    comparison?.resources.filter(
      (pair) =>
        pair.before?.mime.startsWith("image/") ||
        pair.after?.mime.startsWith("image/"),
    ) ?? [];
  const visibleIds = allIds.filter(
    (id) =>
      !diff ||
      !comparison ||
      !changedOnly ||
      comparison.pages.some((p) => p.id === id && p.status !== "unchanged"),
  );
  useLayoutEffect(() => {
    if (!current || !pageId) return;
    const next = {
      page: pageId,
      anchor: currentRoute.page === pageId ? currentRoute.anchor : undefined,
    };
    const last = lastNavigation.current;
    if (last?.page === next.page && last?.anchor === next.anchor) return;
    lastNavigation.current = next;
    if (next.anchor) {
      document
        .getElementById(next.anchor)
        ?.scrollIntoView({ behavior: "instant" });
    } else if (last?.page !== next.page) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  }, [currentRoute.page, currentRoute.anchor, pageId, current]);
  async function action(name: string, payload: Record<string, unknown>) {
    await jsonResponse(
      await fetch(endpoint(name), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ...payload, token: state?.token }),
      }),
    );
    await refresh();
  }
  async function chooseRef(ref: string) {
    setSelecting(true);
    try {
      await action("base", { ref });
      setDiff(true);
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setSelecting(false);
    }
  }
  async function browseHistory(direction: "refresh" | "older" | "newer") {
    setSelecting(true);
    try {
      await action("history", { direction });
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setSelecting(false);
    }
  }
  async function rerun() {
    setRunning(true);
    try {
      await action("run", {});
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setRunning(false);
    }
  }
  function tabKeys(event: KeyboardEvent<HTMLButtonElement>) {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? "previous"
          : event.key === "End"
            ? "current"
            : side === "current"
              ? "previous"
              : "current";
      if (next === "previous" && !previous) return;
      setSide(next);
      document.getElementById(`tab-${next}`)?.focus();
    }
  }
  const isDev = boot.mode === "dev";
  const canReview = isDev || boot.mode === "review";
  const fixture = state?.reviewSource;
  return (
    <div
      className="viewer-shell bg-background text-foreground"
      data-lgtmd-part="shell"
    >
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="site-header">
        <a
          className="site-name sidebar-brand flex items-center gap-2.5"
          href={pageHref(current?.navigation[0] ?? pageId ?? "")}
        >
          <svg
            className="brand-mark shrink-0"
            aria-hidden="true"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="4" y="3" width="16" height="18" rx="4" />
            <path d="m8 11 2.5 2.5L16 8M8 17h8" />
          </svg>
          <span>{state?.title ?? "Documentation"}</span>
        </a>
        <button
          type="button"
          className="mobile-nav-toggle"
          aria-label="Toggle navigation"
          aria-controls="docs-navigation"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </header>
      <nav
        className="page-nav"
        id="docs-navigation"
        data-lgtmd-part="sidebar"
        data-open={mobileOpen}
        aria-label="Documentation pages"
      >
        <div className="sidebar-heading">Documentation</div>
        <ul>
          {visibleIds.map((id) => {
            const change = comparison?.pages.find((p) => p.id === id);
            const page =
              current?.pages.find((p) => p.id === id) ??
              previous?.pages.find((p) => p.id === id);
            return (
              <li key={id}>
                <a
                  href={pageHref(id)}
                  aria-current={pageId === id ? "page" : undefined}
                  onClick={(event) => {
                    if (
                      mobileOpen &&
                      event.button === 0 &&
                      !event.metaKey &&
                      !event.ctrlKey &&
                      !event.shiftKey &&
                      !event.altKey
                    ) {
                      setMobileOpen(false);
                      document.getElementById("main-content")?.focus();
                    }
                  }}
                >
                  <span>{page?.title ?? id}</span>
                  {diff && change && change.status !== "unchanged" ? (
                    <span
                      className={`nav-change ${change.status}`}
                      title={
                        {
                          changed: "Modified",
                          added: "Added",
                          removed: "Removed",
                        }[change.status]
                      }
                    >
                      <span aria-hidden="true">
                        {
                          { changed: "M", added: "A", removed: "D" }[
                            change.status
                          ]
                        }
                      </span>
                      <span className="sr-only">
                        {
                          {
                            changed: "Modified",
                            added: "Added",
                            removed: "Removed",
                          }[change.status]
                        }
                      </span>
                    </span>
                  ) : null}
                </a>
              </li>
            );
          })}
        </ul>
        {!visibleIds.length ? (
          <p className="muted">
            {current
              ? "No changed pages."
              : "Pages will appear when the flow completes."}
          </p>
        ) : null}
        <footer className="sidebar-footer" data-lgtmd-part="footer">
          {!canReview && state?.audience === "contributor" ? (
            <div>Contributor documentation</div>
          ) : null}
          <div>Built with lgtmd</div>
        </footer>
      </nav>
      <div className="page-frame" data-lgtmd-part="frame">
        <div className="page-toolbar" data-lgtmd-part="toolbar">
          <div className="page-breadcrumb flex min-w-0 items-center gap-2 text-muted-foreground">
            <span>Docs</span>
            <span aria-hidden="true">/</span>
            <span className="truncate text-foreground">{pageTitle}</span>
          </div>
          <div className="header-actions flex items-center gap-3">
            <ThemeSelect />
          </div>
        </div>
        {failure && !isDev ? (
          <div className="notice warning" role="alert">
            {failure}
            <button type="button" onClick={() => void refresh()}>
              Retry loading
            </button>
          </div>
        ) : null}

        <main id="main-content" data-lgtmd-part="content" tabIndex={-1}>
          {!current ? (
            <section className="empty-state">
              <h1>
                {state?.run.status === "failed"
                  ? "The flow did not produce documentation"
                  : "Preparing documentation"}
              </h1>
              <p>
                {state?.run.status === "failed"
                  ? "Resolve the reported error, then run the flow again."
                  : "Completed content appears here after the flow and its cleanup succeed."}
              </p>
            </section>
          ) : (
            <div data-testid="review-panel" className="review-panel">
              <div className="page-heading">
                {!hasTitle ? <h1>{pageTitle}</h1> : null}
              </div>
              {diff && comparison ? (
                <p
                  className="sr-only"
                  role="status"
                  data-testid="text-review-status"
                >
                  {side === "previous"
                    ? `Deletions in ${fixture?.beforeLabel ?? "previous documentation"}.`
                    : `Additions in ${fixture?.afterLabel ?? "current documentation"}.`}
                  {!textReview
                    ? " Preparing text highlights."
                    : textReview.coverage !== "complete"
                      ? " Some changes use whole-block or page-level review. Details in Versions, Advanced."
                      : " Text highlights ready."}
                </p>
              ) : null}
              <article
                id="document-version"
                role={diff ? "tabpanel" : undefined}
                aria-labelledby={diff ? `tab-${side}` : undefined}
              >
                {selectedPage && selectedBundle ? (
                  <DocumentContent
                    key={`${selectedBundle.digest}:${selectedPage.id}`}
                    page={selectedPage}
                    bundle={selectedBundle}
                    resourceBase={resourceBase}
                    textReview={
                      textReview?.[side === "previous" ? "before" : "after"]
                    }
                    imageReview={
                      comparison
                        ? {
                            enabled: diff,
                            pairs: imagePairs,
                            beforeBase: state?.baseline?.resourceBase ?? "",
                            afterBase: state?.currentResourceBase ?? "",
                            previousRevision:
                              fixture?.beforeLabel ??
                              state?.baseline?.ref ??
                              "Previous",
                            currentRevision: fixture?.afterLabel ?? "Current",
                          }
                        : undefined
                    }
                  />
                ) : (
                  <div className="missing-side">
                    {side === "previous" &&
                    state?.baseline?.status !== "available"
                      ? (state?.baseline?.message ??
                        "No recorded docs at this revision.")
                      : `This page does not exist in the ${side} version.`}
                  </div>
                )}
              </article>
            </div>
          )}
        </main>
      </div>
      {canReview ? (
        <div
          ref={toolsRef}
          className="dev-tools fixed z-50 flex flex-col items-center gap-2"
          onKeyDown={(event) => {
            if (event.key === "Escape" && toolsOpen) {
              event.preventDefault();
              setToolsOpen(false);
              toolsButton.current?.focus();
            }
          }}
        >
          {diff ? (
            <div
              className="segmented dev-context"
              role="tablist"
              aria-label="Document version"
            >
              {textReview && textReview.coverage !== "complete" ? (
                <span
                  className="px-2 text-xs"
                  title="Some changes use whole-block or page-level review. Details in Versions, Advanced."
                >
                  Partial text diff
                </span>
              ) : null}
              <button
                type="button"
                id="tab-previous"
                role="tab"
                aria-selected={side === "previous"}
                aria-controls="document-version"
                disabled={!previous}
                title={
                  fixture?.beforeLabel ??
                  state?.baseline?.commit?.subject ??
                  "Choose a recorded version to view previous documentation"
                }
                tabIndex={side === "previous" ? 0 : -1}
                onKeyDown={tabKeys}
                onClick={() => setSide("previous")}
              >
                {fixture?.beforeLabel ?? "Previous"}
              </button>
              <button
                type="button"
                id="tab-current"
                role="tab"
                aria-selected={side === "current"}
                aria-controls="document-version"
                tabIndex={side === "current" ? 0 : -1}
                onKeyDown={tabKeys}
                onClick={() => setSide("current")}
              >
                {fixture?.afterLabel ?? "Current"}
              </button>
            </div>
          ) : null}
          <div
            className="dev-dock flex items-center gap-1"
            aria-label={fixture ? "Review toolbar" : "Development toolbar"}
          >
            <button
              ref={toolsButton}
              type="button"
              className="dev-tools-toggle flex items-center gap-2"
              aria-label={fixture ? "About this showcase" : "Development tools"}
              aria-expanded={toolsOpen}
              aria-controls="development-panel"
              onClick={() => {
                setToolsOpen(!toolsOpen);
                setHistoryOpen(false);
              }}
            >
              <strong>lgtmd</strong>
              <span
                className={`status-dot ${!connected || failure ? "failed" : (state?.run.status ?? "idle")}`}
              />
              <span className="dev-status" role="status">
                {fixture
                  ? "Showcase"
                  : !connected
                    ? "Disconnected"
                    : failure
                      ? "Error"
                      : state?.run.status === "running"
                        ? "Running…"
                        : state?.run.status === "failed"
                          ? state.run.stale
                            ? "Failed · stale"
                            : "Failed"
                          : state?.run.status === "cancelled"
                            ? state.run.stale
                              ? "Cancelled · stale"
                              : "Cancelled"
                            : state?.run.retained
                              ? "Retained"
                              : state?.run.stale
                                ? "Stale"
                                : state?.run.status === "succeeded"
                                  ? "Ready"
                                  : "Waiting…"}
              </span>
              <span aria-hidden="true" className="dev-chevron">
                {toolsOpen ? "⌄" : "⌃"}
              </span>
            </button>
            <button
              ref={historyButton}
              type="button"
              className="dev-tools-toggle flex items-center gap-1.5"
              aria-label="Version history"
              aria-expanded={historyOpen}
              aria-controls="version-sheet"
              onClick={() => {
                setHistoryOpen(!historyOpen);
                setToolsOpen(false);
              }}
            >
              <History size={14} aria-hidden="true" />
              Versions
            </button>
            {isDev ? (
              <button
                type="button"
                className="dev-tools-toggle"
                aria-label="Run again"
                title="Run again"
                disabled={
                  !state?.canRun || running || state.run.status === "running"
                }
                onClick={() => void rerun()}
              >
                <RotateCw size={14} aria-hidden="true" />
              </button>
            ) : null}
            <label className="diff-toggle">
              <input
                type="checkbox"
                checked={diff}
                onChange={(event) => setDiff(event.target.checked)}
              />
              View diff
            </label>
          </div>
          {toolsOpen ? (
            <section
              id="development-panel"
              className="dev-panel"
              aria-label={fixture ? "About this showcase" : "Development tools"}
            >
              <header className="dev-panel-heading flex items-center justify-between gap-3">
                <div>
                  <strong>
                    {fixture ? "Viewer showcase" : "Development tools"}
                  </strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Audience:{" "}
                    {state?.audience === "contributor"
                      ? "Contributor"
                      : "Reader"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close development tools"
                  onClick={() => {
                    setToolsOpen(false);
                    toolsButton.current?.focus();
                  }}
                >
                  Close
                </button>
              </header>
              {fixture ? (
                <p className="text-sm">{fixture.description}</p>
              ) : (
                <div className="run-bar" aria-live="polite">
                  <div>
                    <span
                      className={`status-dot ${state?.run.status ?? "idle"}`}
                    />
                    <strong>
                      {state?.run.status === "running"
                        ? "Running flow…"
                        : state?.run.retained
                          ? "Retained output"
                          : state?.run.status === "succeeded"
                            ? "Flow completed"
                            : state?.run.status === "failed"
                              ? "Flow failed"
                              : state?.run.status === "cancelled"
                                ? "Flow cancelled"
                                : "Waiting for documentation"}
                    </strong>
                    {state?.run.retained ? (
                      <span>Not freshly verified.</span>
                    ) : null}
                    {state?.run.stale ? (
                      <span className="stale">
                        Showing the previous successful result.
                      </span>
                    ) : null}
                    {state?.run.message ? (
                      <span className="run-message">{state.run.message}</span>
                    ) : null}
                  </div>
                </div>
              )}
              {!connected ? (
                <div className="notice warning" role="status">
                  Connection interrupted. Displayed documentation may be stale;
                  reconnecting automatically.
                </div>
              ) : null}
              {failure ? (
                <div className="notice warning" role="alert">
                  {failure}
                  <button type="button" onClick={() => void refresh()}>
                    Retry loading
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
      {canReview && historyOpen ? (
        <aside
          ref={historyRef}
          id="version-sheet"
          role="dialog"
          aria-label="Version history"
          className="version-sheet fixed z-50 flex flex-col overflow-hidden border border-border bg-surface text-foreground"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">Versions</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Compare with current docs
              </p>
            </div>
            <button
              ref={historyClose}
              type="button"
              className="sheet-icon-button"
              aria-label="Close version history"
              onClick={() => {
                setHistoryOpen(false);
                historyButton.current?.focus({ preventScroll: true });
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          {failure || !connected ? (
            <p
              role="alert"
              className="px-5 py-3 text-xs text-[var(--lgtmd-danger)]"
            >
              {failure ?? "Disconnected. Displayed history may be stale."}
            </p>
          ) : null}
          {state ? (
            <RevisionReview
              state={state}
              textReview={textReview}
              onSelect={chooseRef}
              onHistory={browseHistory}
              selecting={selecting}
              changedOnly={changedOnly}
              onChangedOnly={setChangedOnly}
            />
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
