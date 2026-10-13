import { useEffect, useId, useRef, useState } from "react";
import {
  Columns2,
  GripVertical,
  SlidersHorizontal,
  SquareSplitHorizontal,
} from "lucide-react";
import { resourceUrl, type ResourcePair } from "./protocol.ts";
import type { RegionResult } from "./regions.ts";

type ImageSize = { width: number; height: number };
function ChangeMarks({ result }: { result?: RegionResult }) {
  if (!result) return null;
  return (
    <svg
      className="change-marks"
      viewBox={`0 0 ${result.width} ${result.height}`}
      aria-label="Changed pixel regions"
      role="img"
    >
      {result.boxes.map((box, index) => (
        <rect key={index} {...box} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
function ComparedImage({
  src,
  alt,
  marks,
}: {
  src: string;
  alt: string;
  marks?: RegionResult;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <p className="image-display-error">
      Image unavailable.{" "}
      <a href={src} download>
        Download resource
      </a>
    </p>
  ) : (
    <div className="annotated-image">
      <img src={src} alt={alt} onError={() => setFailed(true)} />
      <ChangeMarks result={marks} />
    </div>
  );
}
function reason(pair: ResourcePair): string | undefined {
  if (!pair.before || !pair.after)
    return "Slider and annotations require an image on both sides. Showing side by side.";
  if (!pair.compatible)
    return pair.compatibility === "different-profile"
      ? "Capture profiles differ. Showing side by side without annotations."
      : pair.compatibility === "different-format"
        ? "Image formats differ. Showing side by side without annotations."
        : "These captures cannot be aligned. Showing side by side without annotations.";
  if (
    !["image/png", "image/webp"].includes(pair.before.mime) ||
    !["image/png", "image/webp"].includes(pair.after.mime)
  )
    return "Slider and annotations support static PNG and WebP only. Other images display side by side; animations play independently.";
  if (
    pair.before.bytes > 32 * 1024 * 1024 ||
    pair.after.bytes > 32 * 1024 * 1024
  )
    return "Slider and annotations support at most 32 MiB per image. Showing side by side.";
  if (typeof Worker === "undefined")
    return "This browser cannot inspect images for alignment. Showing side by side.";
  return undefined;
}
export function ImageComparison({
  pair,
  active,
  source,
  alt,
  title,
  link,
  beforeBase,
  afterBase,
  previousRevision,
  currentRevision,
}: {
  pair: ResourcePair;
  active: boolean;
  source: string;
  alt: string;
  title?: string;
  link?: { href: string; title?: string; download?: string };
  beforeBase: string;
  afterBase: string;
  previousRevision: string;
  currentRevision: string;
}) {
  const [controlsOpen, setControlsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pairRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const controlsId = useId();
  useEffect(() => {
    if (!active) {
      setControlsOpen(false);
      setDragging(false);
    }
  }, [active]);
  useEffect(() => {
    if (!controlsOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!controlsRef.current?.contains(event.target as Node))
        setControlsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setControlsOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape, true);
    };
  }, [controlsOpen]);
  const [mode, setMode] = useState<"slider" | "sides">("slider");
  const [annotations, setAnnotations] = useState(false);
  const [inspection, setInspection] = useState<{
    key: string;
    size: ImageSize;
    result?: RegionResult;
  }>();
  const [failure, setFailure] = useState<string>();
  const [displayFailure, setDisplayFailure] = useState(false);
  const [failedSource, setFailedSource] = useState<string>();
  const [running, setRunning] = useState(false);
  const [position, setPosition] = useState(50);
  const eligibility = reason(pair);
  const before = pair.before ? resourceUrl(beforeBase, pair.before) : "";
  const after = pair.after ? resourceUrl(afterBase, pair.after) : "";
  const key = `${before}\n${after}`;
  const currentInspection = inspection?.key === key ? inspection : undefined;
  const inspect = active && (mode === "slider" || annotations);
  useEffect(() => {
    setPosition(50);
    setDisplayFailure(false);
  }, [before, after]);
  useEffect(() => {
    setFailure(undefined);
    setRunning(false);
    if (!inspect || eligibility || !before || !after) return;
    setRunning(true);
    let worker: Worker;
    try {
      worker = new Worker(new URL("./regions.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      setRunning(false);
      setFailure(
        "This browser could not inspect the images. Showing side by side.",
      );
      return;
    }
    worker.onmessage = (event) => {
      setRunning(false);
      if (event.data.ok)
        setInspection({
          key,
          size: event.data.size,
          result: event.data.result,
        });
      else setFailure(event.data.message);
      worker.terminate();
    };
    worker.onerror = () => {
      setRunning(false);
      setFailure("Image inspection could not complete. Showing side by side.");
      worker.terminate();
    };
    worker.postMessage({ before, after, analyze: annotations });
    return () => worker.terminate();
  }, [inspect, annotations, eligibility, before, after, key]);
  const marks = annotations && !running ? currentInspection?.result : undefined;
  const slider =
    mode === "slider" &&
    currentInspection &&
    !eligibility &&
    !failure &&
    !displayFailure;
  const notice = inspect ? eligibility || failure : undefined;
  const showPair =
    active &&
    !slider &&
    Boolean(mode === "sides" || eligibility || failure || displayFailure);
  useEffect(() => {
    const strip = pairRef.current;
    if (!showPair || !strip) return;
    let cancelled = false;
    // Start at the seam so both captures are visible at the frame height.
    void Promise.allSettled(
      Array.from(strip.querySelectorAll("img"), (image) => image.decode()),
    ).then(() => {
      if (!cancelled)
        strip.scrollLeft = (strip.scrollWidth - strip.clientWidth) / 2;
    });
    return () => {
      cancelled = true;
    };
  }, [showPair, before, after]);
  const baseImage =
    failedSource === source ? (
      <div
        className="image-review-base-error"
        role={active ? undefined : "status"}
      >
        Image unavailable: {alt || title || "resource"}
      </div>
    ) : (
      <img
        className="image-review-base"
        src={source}
        alt={active ? "" : alt}
        title={title}
        onError={() => setFailedSource(source)}
      />
    );
  return (
    <section
      className="image-comparison"
      data-dragging={dragging || undefined}
      data-lgtmd-part="image-comparison"
      data-testid={active ? "image-comparison" : undefined}
      aria-label={active ? `Image comparison: ${pair.id}` : undefined}
    >
      <div className="image-review-stage">
        {link ? (
          <a
            {...link}
            href={active ? undefined : link.href}
            rel="noopener noreferrer"
          >
            {baseImage}
          </a>
        ) : (
          baseImage
        )}
        {active ? (
          <>
            {slider ? (
              <div className="image-slider image-surface">
                <img
                  src={after}
                  alt={`After: ${pair.id}`}
                  onError={() => setDisplayFailure(true)}
                />
                <div
                  className="image-slider-before"
                  style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
                >
                  <img
                    src={before}
                    alt={`Before: ${pair.id}`}
                    onError={() => setDisplayFailure(true)}
                  />
                </div>
                <ChangeMarks result={marks} />
                <div
                  className="image-slider-divider"
                  style={{ left: `${position}%` }}
                  aria-hidden="true"
                >
                  <span>
                    <GripVertical size={14} aria-hidden="true" />
                  </span>
                </div>
                <input
                  className="image-slider-input"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={position}
                  aria-label={`Image reveal: ${pair.id}`}
                  aria-valuetext={`${position}% before, ${100 - position}% after`}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDragging(true);
                    setControlsOpen(false);
                  }}
                  onPointerUp={() => setDragging(false)}
                  onPointerCancel={() => setDragging(false)}
                  onLostPointerCapture={() => setDragging(false)}
                  onChange={(event) => setPosition(Number(event.target.value))}
                />
              </div>
            ) : mode === "sides" || eligibility || failure || displayFailure ? (
              <div
                className="image-pair"
                ref={pairRef}
                tabIndex={0}
                role="region"
                aria-label="Side by side images. Scroll horizontally to inspect Before and After."
              >
                {[
                  { resource: pair.before, base: beforeBase, label: "Before" },
                  { resource: pair.after, base: afterBase, label: "After" },
                ].map(({ resource, base, label }) => (
                  <div className="image-side" key={label}>
                    <span className="image-side-label" aria-hidden="true">
                      {label}
                    </span>
                    {resource ? (
                      <ComparedImage
                        key={resourceUrl(base, resource)}
                        src={resourceUrl(base, resource)}
                        alt={`${label}: ${pair.id}`}
                        marks={marks}
                      />
                    ) : (
                      <span className="missing-side">
                        No image on this side.
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
            <header
              className="image-comparison-header"
              ref={controlsRef}
              data-open={controlsOpen || undefined}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node))
                  setControlsOpen(false);
              }}
            >
              <button
                type="button"
                className="image-controls-trigger"
                ref={triggerRef}
                aria-label="Image comparison controls"
                title="Image comparison controls"
                aria-expanded={controlsOpen}
                aria-controls={controlsId}
                onClick={() => setControlsOpen(!controlsOpen)}
              >
                <SlidersHorizontal size={16} aria-hidden="true" />
              </button>
              <div
                className="image-controls-popover"
                id={controlsId}
                hidden={!controlsOpen}
              >
                <div
                  className="image-view-controls"
                  role="group"
                  aria-label="Image comparison display"
                >
                  <button
                    type="button"
                    aria-pressed={mode === "slider"}
                    onClick={() => setMode("slider")}
                  >
                    <SquareSplitHorizontal size={16} aria-hidden="true" />{" "}
                    Slider
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === "sides"}
                    onClick={() => setMode("sides")}
                  >
                    <Columns2 size={16} aria-hidden="true" /> Side by side
                  </button>
                  <label className="annotation-toggle flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={annotations}
                      onChange={(event) => setAnnotations(event.target.checked)}
                    />
                    Annotations
                  </label>
                  {link ? (
                    <a {...link} rel="noopener noreferrer">
                      Open image link
                    </a>
                  ) : null}
                </div>
                <details className="image-review-details">
                  <summary>
                    {running
                      ? annotations
                        ? "Comparing pixels…"
                        : "Preparing slider…"
                      : notice || displayFailure
                        ? "Slider unavailable · Details"
                        : "Details"}
                  </summary>
                  <div>
                    <strong>
                      {pair.id} · {pair.status}
                    </strong>
                    <p>
                      Before: {previousRevision} · After: {currentRevision}
                    </p>
                    {notice || displayFailure ? (
                      <p role="status">
                        {displayFailure
                          ? "The browser could not display aligned images. Showing side by side."
                          : notice}
                      </p>
                    ) : null}
                    {marks ? (
                      <>
                        <p role="status" data-testid="regions-result">
                          {marks.changedPixels
                            ? `${marks.boxes.length} changed region${marks.boxes.length === 1 ? "" : "s"} · ${marks.changedPixels.toLocaleString()} changed pixels`
                            : pair.status === "changed"
                              ? "Resource bytes changed; no decoded pixel changes were found."
                              : "No decoded pixel changes were found."}
                        </p>
                        <p>
                          Annotations mark groups of changed pixels, not UI
                          elements. They do not change the exact artifact
                          comparison.
                        </p>
                      </>
                    ) : null}
                    <p>
                      Before profile:{" "}
                      <code>{pair.before?.profile ?? "No image"}</code>
                    </p>
                    <p>
                      After profile:{" "}
                      <code>{pair.after?.profile ?? "No image"}</code>
                    </p>
                  </div>
                </details>
              </div>
            </header>
            <div
              className="slider-captions"
              aria-hidden="true"
              hidden={Boolean(showPair)}
            >
              <span title={previousRevision}>Before</span>
              <span title={currentRevision}>After</span>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
