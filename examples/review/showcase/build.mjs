import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareSite, validateSite, storeSite } from "lgtmd";
const here = fileURLToPath(new URL(".", import.meta.url));
export async function readTree(root, prefix = "") {
  const files = {};
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix + entry.name;
    if (entry.isDirectory())
      Object.assign(files, await readTree(root, path + "/"));
    else if (entry.isFile())
      files[path] = Array.from(await readFile(join(root, path)));
    else throw new Error(`Fixture tree contains a non-regular entry: ${path}`);
  }
  return files;
}
export async function buildShowcase(
  destination,
  { audience = "contributor", basePath = "/" } = {},
) {
  if (!["reader", "contributor"].includes(audience))
    throw new Error("Audience must be reader or contributor");
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath))
    throw new Error("Use a slash-delimited base path, such as /showcase/");
  const before = await validateSite(
    await readTree(join(here, "snapshots/original", audience)),
  );
  const after = await validateSite(
    await readTree(join(here, "snapshots/revised", audience)),
  );
  const comparison = await compareSite(before.files, after.files);
  const viewer = await readTree(
    fileURLToPath(new URL("../../../packages/lgtmd/viewer/", import.meta.url)),
  );
  const files = { ...after.files };
  const add = (path, bytes) => {
    if (path in files) throw new Error(`Showcase asset collision: ${path}`);
    files[path] = bytes;
  };
  for (const [path, bytes] of Object.entries(viewer)) add(path, bytes);
  // Only inert WebP captures are served under the earlier-version namespace.
  // Do not turn this example assembler into a generic resource-serving API.
  for (const resource of before.bundle.resources) {
    if (resource.mime !== "image/webp")
      throw new Error("Showcase fixtures only support WebP resources");
    add("original/" + resource.path, before.files[resource.path]);
  }
  const description =
    "Two retained demonstration versions. No Git history, application execution or external service is required. All contributor notes are intentionally public sample content.";
  const state = {
    mode: "static",
    title: after.bundle.title,
    audience,
    reviewSource: {
      kind: "fixture",
      beforeLabel: "Original",
      afterLabel: "Revised",
      description,
    },
    run: { status: "succeeded", retained: true, stale: false },
    current: after.bundle,
    currentResourceBase: basePath,
    baseline: {
      status: "available",
      ref: "Original",
      bundle: before.bundle,
      resourceBase: basePath + "original/",
    },
    comparison,
    canRun: false,
  };
  const boot = JSON.stringify({
    mode: "review",
    basePath,
    dataUrl: "site.json",
  }).replaceAll("<", "\\u003c");
  const html = Buffer.from(files["index.html"]).toString();
  if (!html.includes("<!-- LGTMD_BOOT -->"))
    throw new Error(
      "Prepared viewer is missing its boot placeholder; run just docs-prepare",
    );
  files["index.html"] = Array.from(
    Buffer.from(
      html.replace(
        "<!-- LGTMD_BOOT -->",
        `<script>window.__LGTMD__=${boot}</script>`,
      ),
    ),
  );
  add("site.json", Array.from(Buffer.from(JSON.stringify(state))));
  await storeSite("build", destination, files, "static");
  return state;
}
