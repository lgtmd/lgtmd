import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { DocumentContent, pageHref } from "./content.tsx";
import type { Boot, SiteState } from "./protocol.ts";
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
  const [diff, setDiff] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
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
  const [changedOnly, setChangedOnly] = useState(true);
  const [ref, setRef] = useState("HEAD");
  const [selecting, setSelecting] = useState(false);
  const [running, setRunning] = useState(false);
  const [copyResult, setCopyResult] = useState<"copied" | "unavailable">();
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
    if (state?.baseline?.ref) setRef(state.baseline.ref);
  }, [state?.baseline?.ref]);
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
  useEffect(() => {
    if (!currentRoute.anchor) return;
    const id = window.setTimeout(
      () => document.getElementById(currentRoute.anchor!)?.scrollIntoView(),
      0,
    );
    return () => window.clearTimeout(id);
  }, [currentRoute.anchor, pageId, side, current?.digest, previous?.digest]);
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
  async function chooseRef(event: FormEvent) {
    event.preventDefault();
    setSelecting(true);
    try {
      await action("base", { ref });
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
  async function copyCandidate() {
    if (!state?.candidateId) return;
    try {
      await navigator.clipboard.writeText(state.candidateId);
      setCopyResult("copied");
    } catch {
      setCopyResult("unavailable");
    }
  }
  useEffect(() => setCopyResult(undefined), [state?.candidateId]);
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
      setSide(next);
      document.getElementById(`tab-${next}`)?.focus();
    }
  }
  const isDev = boot.mode === "dev";
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
          {!isDev && state?.audience === "contributor" ? (
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
                    imageReview={
                      comparison
                        ? {
                            enabled: diff,
                            pairs: imagePairs,
                            beforeBase: state?.baseline?.resourceBase ?? "",
                            afterBase: state?.currentResourceBase ?? "",
                            previousRevision:
                              state?.baseline?.ref ?? "Previous",
                            currentRevision: "Current",
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
      {isDev ? (
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
              <button
                type="button"
                id="tab-previous"
                role="tab"
                aria-selected={side === "previous"}
                aria-controls="document-version"
                tabIndex={side === "previous" ? 0 : -1}
                onKeyDown={tabKeys}
                onClick={() => setSide("previous")}
              >
                Previous
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
                Current
              </button>
            </div>
          ) : null}
          <div
            className="dev-dock flex items-center gap-3"
            aria-label="Development toolbar"
          >
            <button
              ref={toolsButton}
              type="button"
              className="dev-tools-toggle flex items-center gap-2"
              aria-label="Development tools"
              aria-expanded={toolsOpen}
              aria-controls="development-panel"
              onClick={() => setToolsOpen(!toolsOpen)}
            >
              <strong>lgtmd</strong>
              <span
                className={`status-dot ${!connected || failure ? "failed" : (state?.run.status ?? "idle")}`}
              />
              <span className="dev-status" role="status">
                {!connected
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
              aria-label="Development tools"
            >
              <header className="dev-panel-heading flex items-center justify-between gap-3">
                <div>
                  <strong>Development tools</strong>
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
                <button
                  type="button"
                  onClick={() => void rerun()}
                  disabled={
                    !state?.canRun || running || state.run.status === "running"
                  }
                >
                  Run again
                </button>
              </div>
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
              {diff ? (
                <section
                  className="review-toolbar"
                  aria-label="Review revisions"
                >
                  {comparison ? (
                    <label className="filter-label">
                      <input
                        type="checkbox"
                        checked={changedOnly}
                        onChange={(event) =>
                          setChangedOnly(event.target.checked)
                        }
                      />
                      Changed pages
                    </label>
                  ) : null}
                  <form onSubmit={(event) => void chooseRef(event)}>
                    <label htmlFor="revision">
                      Compare against Git revision
                    </label>
                    <div>
                      <input
                        id="revision"
                        name="revision"
                        value={ref}
                        onChange={(event) => setRef(event.target.value)}
                        spellCheck={false}
                        autoComplete="off"
                        required
                      />
                      <button type="submit" disabled={selecting}>
                        {selecting ? "Loading…" : "Compare"}
                      </button>
                    </div>
                  </form>
                  <div className="revision-identities">
                    <span>
                      Previous:{" "}
                      <code title={state?.baseline?.revision}>
                        {state?.baseline?.revision?.slice(0, 12) ??
                          state?.baseline?.ref ??
                          "unavailable"}
                      </code>
                    </span>
                    <span>
                      Candidate:{" "}
                      <code title={state?.candidateId}>
                        {state?.candidateId?.slice(0, 12) ?? "pending"}
                      </code>
                    </span>
                    {state?.candidateId ? (
                      <button
                        type="button"
                        onClick={() => void copyCandidate()}
                      >
                        Copy candidate ID
                      </button>
                    ) : null}
                    {copyResult === "copied" ? (
                      <span role="status">Candidate ID copied.</span>
                    ) : null}
                    {copyResult === "unavailable" ? (
                      <label>
                        Copy this candidate ID
                        <input
                          aria-label="Candidate ID"
                          readOnly
                          value={state?.candidateId}
                          onFocus={(event) => event.currentTarget.select()}
                        />
                      </label>
                    ) : null}
                  </div>
                  {state?.baseline?.status !== "available" ? (
                    <p className="notice">
                      {state?.baseline?.message ??
                        "No recorded docs at this revision."}
                    </p>
                  ) : null}
                  {comparison?.site_changed ? (
                    <p className="site-change">
                      Site title or navigation changed.
                    </p>
                  ) : null}
                </section>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
