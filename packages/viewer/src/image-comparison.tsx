import { useEffect, useState } from "react";
import { resourceUrl, type Resource, type ResourcePair } from "./protocol.ts";
import type { RegionResult } from "./regions.ts";

interface SideProps {
  resource?: Resource;
  base: string;
  label: string;
  revision: string;
}
function ImageSide({ resource, base, label, revision }: SideProps) {
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [error, setError] = useState(false);
  useEffect(() => {
    setSize(undefined);
    setError(false);
  }, [resource?.sha256, resource?.path, base]);
  return (
    <figure className="image-side">
      <figcaption>
        <strong>{label}</strong>
        <span title={revision}>{revision}</span>
        {size ? (
          <span>
            {size.width} × {size.height} px
          </span>
        ) : null}
      </figcaption>
      {resource ? (
        <>
          <div className="image-surface">
            {error ? (
              <div className="notice warning">
                The browser could not display this image.{" "}
                <a href={resourceUrl(base, resource)} download>
                  Download resource
                </a>
              </div>
            ) : (
              <img
                src={resourceUrl(base, resource)}
                alt={`${label}: ${resource.id}`}
                onLoad={(event) =>
                  setSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                onError={() => setError(true)}
              />
            )}
          </div>
          <div className="resource-profile">
            Capture profile: <code>{resource.profile}</code>
          </div>
        </>
      ) : (
        <div className="missing-side">No image on this side.</div>
      )}
    </figure>
  );
}
function reason(pair: ResourcePair): string | undefined {
  if (!pair.before || !pair.after)
    return "Regions requires an image on both sides.";
  if (!pair.compatible)
    return pair.compatibility === "different-profile"
      ? "Capture profiles differ. Regions requires matching profiles."
      : pair.compatibility === "different-format"
        ? "Image formats differ. Use Before / After."
        : "These captured resources are not compatible for Regions.";
  if (
    !["image/png", "image/webp"].includes(pair.before.mime) ||
    !["image/png", "image/webp"].includes(pair.after.mime)
  )
    return "Regions supports static PNG and WebP images only. Animated previews play independently.";
  if (
    pair.before.bytes > 32 * 1024 * 1024 ||
    pair.after.bytes > 32 * 1024 * 1024
  )
    return "Regions supports at most 32 MiB of encoded data per image.";
  if (
    typeof Worker === "undefined" ||
    typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap === "undefined"
  )
    return "This browser does not support worker image analysis.";
  return undefined;
}
export function ImageComparison({
  pair,
  beforeBase,
  afterBase,
  previousRevision,
  currentRevision,
}: {
  pair: ResourcePair;
  beforeBase: string;
  afterBase: string;
  previousRevision: string;
  currentRevision: string;
}) {
  const [mode, setMode] = useState<"sides" | "regions">("sides");
  const [result, setResult] = useState<RegionResult>();
  const [failure, setFailure] = useState<string>();
  const [running, setRunning] = useState(false);
  const eligibility = reason(pair);
  const before = pair.before ? resourceUrl(beforeBase, pair.before) : "";
  const after = pair.after ? resourceUrl(afterBase, pair.after) : "";
  useEffect(() => {
    setMode("sides");
    setResult(undefined);
    setFailure(undefined);
  }, [before, after]);
  useEffect(() => {
    if (mode !== "regions" || eligibility || !before || !after) return;
    setRunning(true);
    setResult(undefined);
    setFailure(undefined);
    let worker: Worker;
    try {
      worker = new Worker(new URL("./regions.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      setRunning(false);
      setFailure(
        "This browser could not start image analysis. Use Before / After.",
      );
      setMode("sides");
      return;
    }
    worker.onmessage = (event) => {
      setRunning(false);
      if (event.data.ok) setResult(event.data.result);
      else {
        setFailure(event.data.message);
        setMode("sides");
      }
      worker.terminate();
    };
    worker.onerror = () => {
      setRunning(false);
      setFailure("Image analysis could not complete. Use Before / After.");
      setMode("sides");
      worker.terminate();
    };
    worker.postMessage({ before, after });
    return () => worker.terminate();
  }, [mode, eligibility, before, after]);
  return (
    <section
      className="image-comparison"
      data-lgtmd-part="image-comparison"
      data-testid="image-comparison"
      aria-label={`Image comparison: ${pair.id}`}
    >
      <header className="image-comparison-header">
        <div>
          <h3>{pair.id}</h3>
          <span className={`badge ${pair.status}`}>{pair.status}</span>
        </div>
        <div className="segmented" aria-label="Image comparison display">
          <button
            type="button"
            aria-pressed={mode === "sides"}
            onClick={() => setMode("sides")}
          >
            Before / After
          </button>
          <button
            type="button"
            aria-pressed={mode === "regions"}
            disabled={Boolean(eligibility)}
            title={eligibility}
            onClick={() => setMode("regions")}
          >
            Regions
          </button>
        </div>
      </header>
      {eligibility || failure ? (
        <p className="image-notice" role="status">
          {failure || eligibility}
        </p>
      ) : null}
      {mode === "sides" ? (
        <div className="image-pair">
          <ImageSide
            resource={pair.before}
            base={beforeBase}
            label="Before"
            revision={previousRevision}
          />
          <ImageSide
            resource={pair.after}
            base={afterBase}
            label="After"
            revision={currentRevision}
          />
        </div>
      ) : (
        <div className="regions-view">
          {running ? <p role="status">Comparing image pixels…</p> : null}
          {result ? (
            <>
              <p role="status" data-testid="regions-result">
                {result.changedPixels
                  ? `${result.boxes.length} changed region${result.boxes.length === 1 ? "" : "s"} · ${result.changedPixels.toLocaleString()} changed pixels`
                  : pair.status === "changed"
                    ? "Resource bytes changed; no decoded pixel changes were found."
                    : "No decoded pixel changes were found."}
              </p>
              <div
                className="regions-surface"
                style={{ width: result.width, maxWidth: "100%" }}
              >
                <img
                  src={after}
                  alt={`After: ${pair.id}, with changed regions`}
                />
                <svg
                  viewBox={`0 0 ${result.width} ${result.height}`}
                  aria-label="Changed pixel regions"
                  role="img"
                >
                  {result.boxes.map((box, index) => (
                    <rect
                      key={index}
                      {...box}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </svg>
              </div>
            </>
          ) : null}
          <p className="image-notice">
            Boxes group changed 16 × 16 pixel tiles. They do not identify UI
            elements. Browser pixel analysis does not change the exact artifact
            comparison.
          </p>
        </div>
      )}
    </section>
  );
}
