import type { TextReview } from "./text-diff.ts";
import { useEffect, useState, type FormEvent } from "react";
import {
  Check,
  GitCommitHorizontal,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Change, GitCommit, SiteState } from "./protocol.ts";

function CommitTime({ seconds }: { seconds: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  const delta = Math.round((seconds * 1000 - now) / 1000);
  const [amount, unit] =
    Math.abs(delta) < 60
      ? ([delta, "second"] as const)
      : Math.abs(delta) < 3600
        ? ([Math.round(delta / 60), "minute"] as const)
        : Math.abs(delta) < 86400
          ? ([Math.round(delta / 3600), "hour"] as const)
          : ([Math.round(delta / 86400), "day"] as const);
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString()}>
      {Math.abs(delta) < 60
        ? "just now"
        : Math.abs(delta) < 7 * 86400
          ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
              amount,
              unit,
            )
          : date.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
    </time>
  );
}
function CommitLabel({ commit }: { commit: GitCommit }) {
  const refs = commit.decorations.split(", ");
  const label =
    refs.find((ref) => ref.startsWith("HEAD -> "))?.slice(8) ??
    refs.find((ref) => ref.startsWith("tag: "))?.slice(5) ??
    refs.find((ref) => ref && ref !== "HEAD");
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium" title={commit.subject}>
        {commit.subject || "Untitled commit"}
      </span>
      <span className="mt-1 flex items-center gap-2 overflow-hidden text-xs text-muted-foreground">
        <CommitTime seconds={commit.committedAt} />
        {label ? (
          <span className="truncate" title={commit.decorations}>
            {label}
          </span>
        ) : null}
      </span>
    </span>
  );
}
function ChangeCounts({
  items,
  label,
}: {
  items: { status: Change }[];
  label: string;
}) {
  const added = items.filter((item) => item.status === "added").length;
  const removed = items.filter((item) => item.status === "removed").length;
  const modified = items.filter((item) => item.status === "changed").length;
  return (
    <span
      className="flex items-center gap-2"
      aria-label={`${added} added, ${removed} removed, ${modified} modified ${label}`}
    >
      <span>{label}</span>
      <span className="text-[var(--lgtmd-success)]" title={`Added ${label}`}>
        +{added}
      </span>
      <span className="text-[var(--lgtmd-danger)]" title={`Removed ${label}`}>
        −{removed}
      </span>
      <span title={`Modified ${label}`}>M {modified}</span>
    </span>
  );
}
export function RevisionReview({
  state,
  textReview,
  onSelect,
  onHistory,
  selecting,
  changedOnly,
  onChangedOnly,
}: {
  state: SiteState;
  textReview?: TextReview;
  onSelect: (reference: string) => Promise<void>;
  onHistory: (direction: "refresh" | "older" | "newer") => Promise<void>;
  selecting: boolean;
  changedOnly: boolean;
  onChangedOnly: (value: boolean) => void;
}) {
  const [reference, setReference] = useState(state.baseline?.ref ?? "HEAD");
  const [copied, setCopied] = useState(false);
  useEffect(
    () => setReference(state.baseline?.ref ?? "HEAD"),
    [state.baseline?.ref],
  );
  useEffect(() => setCopied(false), [state.candidateId]);
  const baseline = state.baseline;
  const commits = state.history?.commits ?? [];
  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSelect(reference.trim());
  }
  if (state.reviewSource)
    return (
      <section
        className="revision-review space-y-5 overflow-y-auto p-5 text-sm"
        aria-label="Review revisions"
      >
        <p className="text-muted-foreground">
          {state.reviewSource.description}
        </p>
        <dl className="space-y-2">
          <div>
            <dt className="text-xs text-muted-foreground">Before</dt>
            <dd>{state.reviewSource.beforeLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">After</dt>
            <dd>{state.reviewSource.afterLabel}</dd>
          </div>
        </dl>
        {state.comparison ? (
          <div className="space-y-2 text-xs" aria-label="Documentation changes">
            <ChangeCounts items={state.comparison.pages} label="pages" />
            <ChangeCounts items={state.comparison.resources} label="assets" />
          </div>
        ) : null}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={changedOnly}
            onChange={(event) => onChangedOnly(event.target.checked)}
          />
          Changed pages
        </label>
        <details>
          <summary>Advanced</summary>
          <p className="mt-3 text-xs text-muted-foreground">
            {textReview && textReview.coverage !== "complete"
              ? `Detailed text review is partial: ${textReview.reasons.join(", ")}. Complex or ambiguous changes use whole-block markers; work limits use page-level review. `
              : ""}
            Page and asset changes use the same exact comparison engine as Git
            review. These named fixtures have no commit IDs or live flow.
          </p>
        </details>
      </section>
    );
  return (
    <section
      className="revision-review flex min-h-0 flex-1 flex-col text-xs"
      aria-label="Review revisions"
    >
      <div className="flex shrink-0 items-center justify-between px-5 py-2">
        <span className="text-muted-foreground">Project history</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="sheet-text-button"
            disabled={selecting}
            onClick={() => void onSelect("HEAD")}
          >
            Latest commit
          </button>
          <button
            type="button"
            className="sheet-icon-button"
            aria-label="Refresh project history"
            title="Refresh project history"
            disabled={selecting}
            onClick={() => void onHistory("refresh")}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2">
        {commits.length ? (
          <ul className="revision-list" aria-label="Project history">
            {commits.map((commit) => (
              <li
                key={commit.revision}
                aria-label={
                  baseline?.revision === commit.revision
                    ? "Selected commit"
                    : undefined
                }
              >
                <button
                  type="button"
                  className="flex w-full items-start gap-3 p-3 text-left disabled:opacity-50"
                  title={commit.revision}
                  disabled={selecting}
                  aria-pressed={baseline?.revision === commit.revision}
                  onClick={() => void onSelect(commit.revision)}
                >
                  <GitCommitHorizontal
                    size={16}
                    className="mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <CommitLabel commit={commit} />
                  {baseline?.revision === commit.revision ? (
                    <Check
                      size={14}
                      className="mt-0.5 shrink-0"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            {state.history?.message
              ? "Local version history is unavailable. You can still enter a Git reference below."
              : state.history
                ? "No commits in local Git history yet."
                : "Loading local version history…"}
          </p>
        )}
      </div>
      <footer className="revision-footer shrink-0 space-y-3 overflow-y-auto border-t border-border px-5 py-3">
        {baseline?.commit &&
        !commits.some((commit) => commit.revision === baseline.revision) ? (
          <div aria-label="Selected commit" className="flex items-start gap-2">
            <Check size={14} aria-hidden="true" />
            <CommitLabel commit={baseline.commit} />
          </div>
        ) : null}
        {baseline?.status === "loading" || selecting ? (
          <p role="status" className="text-muted-foreground">
            Loading…
          </p>
        ) : baseline?.status !== "available" ? (
          <div role="status" className="text-muted-foreground">
            {baseline?.code === "missing-snapshot" ? (
              "No saved docs at this commit."
            ) : (
              <>
                <span>Comparison unavailable.</span>{" "}
                <span className="break-words">{baseline?.message}</span>
              </>
            )}
          </div>
        ) : null}
        {state.history &&
        (state.history.offset > 0 || state.history.truncated) ? (
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={selecting || state.history.offset === 0}
              aria-label="Newer commits"
              title="Newer commits"
              className="sheet-icon-button"
              onClick={() => void onHistory("newer")}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <span className="text-muted-foreground">
              {state.history.offset + 1}–{state.history.offset + commits.length}
            </span>
            <button
              type="button"
              disabled={selecting || !state.history.truncated}
              aria-label="Older commits"
              title="Older commits"
              className="sheet-icon-button"
              onClick={() => void onHistory("older")}
            >
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {state.comparison ? (
          <div className="space-y-2" aria-label="Documentation changes">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <ChangeCounts items={state.comparison.pages} label="pages" />
              <ChangeCounts items={state.comparison.resources} label="assets" />
            </div>
            {state.comparison.site_changed ? (
              <p>Site title or navigation changed.</p>
            ) : null}
            <label className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                checked={changedOnly}
                onChange={(event) => onChangedOnly(event.target.checked)}
              />
              Changed pages only
            </label>
          </div>
        ) : null}
        <details className="revision-details">
          <summary className="cursor-pointer text-muted-foreground">
            Advanced
          </summary>
          <div className="mt-3 space-y-3">
            {textReview && textReview.coverage !== "complete" ? (
              <p role="status" className="text-muted-foreground">
                Text review is partial:{" "}
                {textReview.reasons
                  .map(
                    (reason) =>
                      ({
                        structure:
                          "formatting, links, whitespace, or structure changed",
                        ambiguous: "blocks could not be matched confidently",
                        unsupported:
                          "complex content or notes use coarse review",
                        budget:
                          "detailed review exceeded its work limit or was unavailable",
                        "missing-side": "no comparison content is available",
                      })[reason],
                  )
                  .join("; ")}
                . Exact page and asset status is unchanged.
              </p>
            ) : null}
            {baseline?.code === "missing-snapshot" ? (
              <p className="text-muted-foreground">
                To review docs here, record a reviewed candidate and commit its
                snapshot directory.
              </p>
            ) : null}
            <form onSubmit={(event) => void submit(event)}>
              <label className="mb-1 block" htmlFor="revision">
                Branch, tag, or commit
              </label>
              <div className="flex gap-2">
                <input
                  id="revision"
                  className="min-w-0 flex-1"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  required
                />
                <button type="submit" disabled={selecting}>
                  Compare
                </button>
              </div>
            </form>
            {baseline?.revision ? (
              <p className="break-all text-muted-foreground">
                Git commit: <code>{baseline.revision}</code>
              </p>
            ) : null}
            {state.history?.message ? (
              <p className="break-words text-muted-foreground">
                {state.history.message}
              </p>
            ) : null}
            {state.candidateId ? (
              <div className="space-y-2">
                <p className="text-muted-foreground">
                  Candidate ID identifies generated documentation, not a Git
                  commit. Use it with <code>lgtmd update --candidate</code>.
                </p>
                <input
                  className="w-full font-mono text-xs"
                  aria-label="Candidate ID"
                  readOnly
                  value={state.candidateId}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(state.candidateId!);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? "Copied" : "Copy candidate ID"}
                </button>
              </div>
            ) : null}
          </div>
        </details>
      </footer>
    </section>
  );
}
