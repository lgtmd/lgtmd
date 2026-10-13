import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  compileSite,
  compareSite,
  storeSite,
  type SiteCompilation,
} from "lgtmd";
import { collectStay, root, siteOptions } from "./collect.ts";
import { runAcceptance } from "./browser/acceptance.ts";

async function complete(mode: "test" | "supplied", script: "A" | "B" = "A") {
  // Never compile frozen attachments from an unsuccessful application lifecycle.
  return compileSite(await collectStay({ mode, script }), siteOptions);
}

function privacy(candidate: SiteCompilation) {
  assert.deepEqual(candidate.reader.bundle.navigation, siteOptions.navigation);
  assert.equal(candidate.reader.bundle.pages.length, 4);
  assert(
    candidate.reader.bundle.pages.every((page) => page.notes.length === 0),
  );
  assert(
    candidate.contributor.bundle.pages.every((page) => page.notes.length > 0),
  );
  for (const files of [candidate.reader.files, candidate.markdown.reader]) {
    assert(
      !Object.keys(files).some((name) => name.includes("fixture-receipt")),
    );
    for (const [name, bytes] of Object.entries(files)) {
      if (name.endsWith(".webp")) continue;
      const content = Buffer.from(bytes).toString();
      assert(!content.includes("stay-private-fixture-receipt"));
      assert(!content.includes("Bearer "));
      assert(
        !/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/i.test(
          content,
        ),
        "Random workspace/session identifiers must stay out of exported content",
      );
    }
  }
  assert(
    candidate.contributor.bundle.resources.some(
      (resource) => resource.id === "fixture-receipt",
    ),
  );
  for (const resource of candidate.reader.bundle.resources) {
    assert.equal(resource.mime, "image/webp");
    assert(resource.profile.includes("1280x900-cpu-full-raster"));
  }
}

async function snapshotBytes(
  directory: string,
): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {};
  async function visit(path: string, prefix = "") {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await visit(join(path, entry.name), `${name}/`);
      else files[name] = await readFile(join(path, entry.name));
    }
  }
  await visit(directory);
  return files;
}

async function handoffFailure(
  fault: "assertion" | "cleanup",
  directory: string,
) {
  const output = resolve(directory, `failed-${fault}.json`);
  const child = spawn(process.execPath, [resolve(root, "run.ts")], {
    cwd: root,
    env: {
      ...process.env,
      STAY_FAULT: fault,
      STAY_MODE: "test",
      LGTMD_RUN_ID: `stay-negative-${fault}`,
      LGTMD_OUTPUT: output,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostic = "";
  child.stdout.on("data", (bytes) => {
    diagnostic += bytes;
  });
  child.stderr.on("data", (bytes) => {
    diagnostic += bytes;
  });
  const code = await new Promise<number | null>((done, reject) => {
    child.once("error", reject);
    child.once("close", done);
  });
  await writeFile(resolve(root, `.cache/${fault}-failure.log`), diagnostic);
  assert.notEqual(
    code,
    0,
    `The ${fault} probe must fail the real host process`,
  );
  await assert.rejects(
    readFile(output),
    { code: "ENOENT" },
    `The ${fault} probe must not write a successful native handoff`,
  );
  // The guarded reporter keeps terminal output concise. Inspect the original
  // failed test's error details rather than matching source text in its trace.
  const contexts = await snapshotBytes(resolve(root, ".cache/playwright"));
  const errors = Object.entries(contexts)
    .filter(([name]) => name.endsWith("error-context.md"))
    .map(([, bytes]) => bytes.toString().split("# Page snapshot")[0])
    .join("\n");
  const expected =
    fault === "assertion"
      ? "Deliberate Stay scenario assertion failure"
      : "Deliberate Stay fixture cleanup failure";
  assert(
    errors.includes(`Error: ${expected}`),
    `The ${fault} probe must fail for its declared reason`,
  );
  await writeFile(resolve(root, `.cache/${fault}-failure-details.log`), errors);
}

const directory = await realpath(
  await mkdtemp(join(tmpdir(), "lgtmd-stay-verification-")),
);
await mkdir(resolve(root, ".cache"), { recursive: true });
try {
  const licenses = await readFile(
    resolve(root, "dist/assets/licenses.txt"),
    "utf8",
  );
  for (const dependency of ["lucide-react", "react", "react-dom"]) {
    const original = await readFile(
      resolve(root, `../../node_modules/${dependency}/LICENSE`),
      "utf8",
    );
    assert(
      licenses.includes(original.trim()),
      `The browser build must retain ${dependency}'s complete license notice`,
    );
  }
  await runAcceptance();
  const first = await complete("test");
  const repeat = await complete("test");
  assert.equal(
    repeat.candidate_id,
    first.candidate_id,
    "Two fresh test-owned A collections must match exactly",
  );
  assert.deepEqual(repeat, first);
  privacy(first);
  const supplied = await complete("supplied");
  const suppliedRepeat = await complete("supplied");
  assert.equal(
    suppliedRepeat.candidate_id,
    supplied.candidate_id,
    "Two fresh supplied A collections must match exactly",
  );
  assert.deepEqual(suppliedRepeat, supplied);
  privacy(supplied);
  assert.deepEqual(
    supplied.reader,
    first.reader,
    "Fixture ownership must not change Reader output",
  );
  assert.deepEqual(supplied.markdown.reader, first.markdown.reader);

  const snapshot = resolve(directory, "baseline-a");
  await storeSite("build", snapshot, first.reader.files);
  await storeSite("check", snapshot, repeat.reader.files);
  const beforeSnapshot = await snapshotBytes(snapshot);
  const alternate = await complete("test", "B");
  const drift = await compareSite(first.reader.files, alternate.reader.files);
  assert.notEqual(alternate.candidate_id, first.candidate_id);
  assert.notEqual(drift.before, drift.after);
  assert.equal(
    drift.site_changed,
    false,
    "A/B replies change pages/resources, not site title or navigation",
  );
  assert.equal(
    drift.pages.find((page) => page.id === "request-a-stay")?.status,
    "changed",
    "Saved A/B reply must cause visible document drift",
  );
  assert(
    drift.resources.some(
      (resource) =>
        resource.status === "changed" && resource.id === "accepted-stay",
    ),
  );
  assert.equal(
    drift.pages.find((page) => page.id === "find-a-stay")?.status,
    "unchanged",
    "Filters do not depend on the scripted AI reply",
  );
  assert.equal(
    drift.pages.find((page) => page.id === "find-with-ai")?.status,
    "unchanged",
    "Guest stay-finder chat does not depend on the host reply script",
  );
  await assert.rejects(storeSite("check", snapshot, alternate.reader.files));
  assert.deepEqual(
    await snapshotBytes(snapshot),
    beforeSnapshot,
    "A failed exact check cannot change any A snapshot file",
  );

  await handoffFailure("assertion", directory);
  await handoffFailure("cleanup", directory);
  const disposedAfterPartialSetup: string[] = [];
  await assert.rejects(
    collectStay({
      mode: "supplied",
      fault: "setup",
      onWorkspaceDisposed: (id) => {
        disposedAfterPartialSetup.push(id);
      },
    }),
    /partial setup failure/,
  );
  assert.equal(
    disposedAfterPartialSetup.length,
    1,
    "Partial setup must delete its one acquired workspace before stopping",
  );
  await assert.rejects(
    collectStay({ mode: "supplied", fault: "cleanup" }),
    /outer cleanup failure/,
  );

  // Keep useful fresh candidates for review; these are not accepted baselines.
  for (const [name, candidate] of [
    ["a-test", first],
    ["a-supplied", supplied],
    ["b-test", alternate],
  ] as const) {
    const destination = resolve(root, ".cache/candidates", name);
    await rm(destination, { recursive: true, force: true });
    await storeSite("build", `${destination}/reader`, candidate.reader.files);
    await storeSite(
      "build",
      `${destination}/contributor`,
      candidate.contributor.files,
    );
    await storeSite(
      "build",
      `${destination}/markdown`,
      candidate.markdown.reader,
      "markdown",
    );
  }
  await writeFile(
    resolve(root, ".cache/verification.json"),
    JSON.stringify(
      {
        captureEnvironment: `${process.platform}-${process.arch}`,
        testOwned: {
          candidate: first.candidate_id,
          reader: first.reader.bundle.digest,
          repeats: 2,
        },
        supplied: {
          candidate: supplied.candidate_id,
          reader: supplied.reader.bundle.digest,
          repeats: 2,
        },
        alternate: {
          candidate: alternate.candidate_id,
          reader: alternate.reader.bundle.digest,
        },
        crossModeReaderExact: true,
        drift,
        failuresRejected: [
          "scenario assertion",
          "fixture cleanup",
          "outer cleanup",
          "partial setup",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Stay acceptance passed: complete HTTP/browser journey, both fixture modes, exact repeats, Reader privacy, A/B drift and failure-gated handoff.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
