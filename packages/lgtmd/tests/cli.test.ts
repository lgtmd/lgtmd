import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  realpath,
  rename,
  mkdir,
  symlink,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { get, type IncomingMessage } from "node:http";
import { nativeExecutable } from "../src/native.js";

const execute = promisify(execFile);
const sdk = fileURLToPath(new URL("../src/index.js", import.meta.url));
const wrapper = fileURLToPath(new URL("../src/cli.js", import.meta.url));
type Mode = "native" | "npm";
const command = (mode: Mode, args: string[]) =>
  mode === "native"
    ? [nativeExecutable(), ...args]
    : [process.execPath, wrapper, ...args];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
interface State {
  token: string;
  candidateId?: string;
  currentResourceBase: string;
  current?: { digest: string; resources: { path: string }[] };
  run: { status: string; stale: boolean; retained: boolean; message?: string };
  baseline: {
    status: string;
    message?: string;
    revision?: string;
    code?: string;
    commit?: {
      revision: string;
      subject: string;
      committedAt: number;
      decorations: string;
    };
  };
  history?: {
    commits: { revision: string; subject: string; committedAt: number }[];
    truncated: boolean;
    offset: number;
    message?: string;
  };
  comparison?: unknown;
}
async function run(root: string, args: string[], mode: Mode = "native") {
  const [file, ...argv] = command(mode, args);
  return execute(file!, argv, {
    cwd: root,
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
}
function events(stdout: string): Record<string, unknown>[] {
  return stdout.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}
function candidate(stdout: string): string {
  const event = events(stdout)
    .reverse()
    .find((value) => value.event === "candidate");
  assert.equal(typeof event?.id, "string", stdout);
  return event!.id as string;
}
async function waitFor<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  timeout = 15000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (ready(value)) return value;
    await pause(30);
  }
  throw new Error("Timed out waiting for CLI condition");
}
async function serve(root: string, args: string[], mode: Mode = "native") {
  const [file, ...argv] = command(mode, [...args, "--port", "0"]);
  const child = spawn(file!, argv, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  const closed = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`CLI startup timed out: ${stderr}`));
    }, 15000);
    child.stderr.on("data", (bytes) => (stderr += bytes));
    child.stdout.on("data", (bytes) => {
      stdout += bytes;
      const event = events(stdout).find((e) => e.event === "listening");
      if (event) {
        clearTimeout(timeout);
        resolve(event.url as string);
      }
    });
    void closed.then((status) => {
      clearTimeout(timeout);
      reject(new Error(`CLI closed ${JSON.stringify(status)}: ${stderr}`));
    }, reject);
  });
  return {
    child,
    url,
    closed,
    state: async () =>
      (await (await fetch(new URL("__lgtmd/state", url))).json()) as State,
    async stop(signal: NodeJS.Signals = "SIGTERM") {
      if (child.exitCode === null && child.signalCode === null)
        child.kill(signal);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          closed,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              child.kill("SIGKILL");
              reject(new Error(`CLI did not stop: ${stderr}`));
            }, 5000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
async function rerun(server: Awaited<ReturnType<typeof serve>>) {
  const state = await server.state();
  return fetch(new URL("__lgtmd/run", server.url), {
    method: "POST",
    headers: { Origin: new URL(server.url).origin },
    body: JSON.stringify({ token: state.token }),
  });
}
async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "lgtmd-native-cli-")),
  );
  const path = join(root, "lgtmd.config.json");
  const config = {
    title: "CLI fixture",
    flow: {
      command: [process.execPath, "flow.mjs"],
      watch: ["flow.mjs"],
      timeoutMs: 4000,
    },
  };
  const source = `import {Doc,completeRun} from ${JSON.stringify(sdk)};import {appendFile} from 'node:fs/promises';await appendFile('calls','x');const doc=new Doc('hello','Hello');doc.md\`Visible text\`;doc.note\`Private note\`;await completeRun([doc.finish()]);`;
  await writeFile(path, JSON.stringify(config));
  await writeFile(join(root, "flow.mjs"), source);
  return {
    root,
    path,
    config,
    source,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}
async function retained(root: string) {
  const folder = join(root, ".cache/lgtmd/last-success");
  const names = await readdir(folder);
  assert.equal(names.length, 1);
  return JSON.parse(await readFile(join(folder, names[0]!), "utf8")) as {
    candidate_id: string;
  };
}
async function git(root: string, args: string[]) {
  return execute(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgSign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
        GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
      },
    },
  );
}

test("native and npm commands share help, version, argument errors and exit status", async () => {
  const f = await fixture();
  try {
    for (const args of [["--help"], ["--version"]])
      assert.equal(
        (await run(f.root, args, "native")).stdout,
        (await run(f.root, args, "npm")).stdout,
      );
    for (const args of [
      ["dev", "--watch", "--reuse"],
      ["update"],
      ["build", "--port", "0"],
      ["not-a-command"],
    ]) {
      let previous: { code: unknown; stderr: unknown } | undefined;
      for (const mode of ["native", "npm"] as const) {
        await assert.rejects(run(f.root, args, mode), (error: unknown) => {
          const failure = error as { code: unknown; stderr: unknown };
          assert.notEqual(failure.code, 0);
          if (previous)
            assert.deepEqual(
              { code: failure.code, stderr: failure.stderr },
              previous,
            );
          previous = { code: failure.code, stderr: failure.stderr };
          return true;
        });
      }
    }
    await assert.rejects(readFile(join(f.root, "calls")), { code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});
test("native preflight rejects unknown config, overlap, transaction aliases and symlink outputs before authoring", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, "outside"));
    await symlink(join(f.root, "outside"), join(f.root, "alias"));
    for (const change of [
      { extra: true },
      { snapshots: "build", outDir: "build/docs" },
      { snapshots: "snaps", outDir: ".snaps.backup" },
      { outDir: "alias/docs" },
    ]) {
      await writeFile(f.path, JSON.stringify({ ...f.config, ...change }));
      await assert.rejects(run(f.root, ["build"]));
    }
    await assert.rejects(readFile(join(f.root, "calls")), { code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});
test("native and npm builds yield identical immutable candidates and Reader privacy", async () => {
  const f = await fixture();
  try {
    const native = candidate((await run(f.root, ["build"])).stdout);
    const npm = candidate((await run(f.root, ["build"], "npm")).stdout);
    assert.equal(native, npm);
    const completed = JSON.parse(
      await readFile(
        join(f.root, ".cache/lgtmd/candidates", native, "candidate.json"),
        "utf8",
      ),
    );
    assert.equal(
      JSON.stringify(completed.reader).includes("Private note"),
      false,
    );
    assert.equal(
      JSON.stringify(completed.contributor).includes("Private note"),
      true,
    );
    assert.equal((await retained(f.root)).candidate_id, native);
    const publicState = await readFile(
      join(f.root, "build/docs/site.json"),
      "utf8",
    );
    assert.equal(publicState.includes("Private note"), false);
    assert.equal(publicState.includes(native), false);
  } finally {
    await f.dispose();
  }
});
test("reuse is scoped to canonical configuration and rejects tampered candidate bytes", async () => {
  const f = await fixture();
  try {
    const id = candidate((await run(f.root, ["build"])).stdout);
    const other = join(f.root, "other.json");
    await writeFile(other, await readFile(f.path));
    await assert.rejects(
      run(f.root, ["dev", "--reuse", "--config", other, "--port", "0"]),
    );
    const path = join(f.root, ".cache/lgtmd/candidates", id, "candidate.json");
    const value = JSON.parse(await readFile(path, "utf8"));
    value.reader.bundle.title = "Tampered";
    await writeFile(path, JSON.stringify(value));
    await assert.rejects(run(f.root, ["update", "--candidate", id]));
    await assert.rejects(run(f.root, ["dev", "--reuse", "--port", "0"]));
    assert.equal(await readFile(join(f.root, "calls"), "utf8"), "x");
  } finally {
    await f.dispose();
  }
});
test("write-then-fail, stale token, missing handoff and timeout preserve retained success", async () => {
  const f = await fixture();
  try {
    const id = candidate((await run(f.root, ["build"])).stdout);
    for (const source of [
      f.source + "\nprocess.exitCode=3;",
      `import{writeFile}from'node:fs/promises';await writeFile(process.env.LGTMD_OUTPUT,JSON.stringify({schema_version:1,run_id:'stale',input:{schema_version:1,documents:[]}}));`,
      "",
      "setInterval(()=>{},1000)",
    ]) {
      await writeFile(join(f.root, "flow.mjs"), source);
      await assert.rejects(run(f.root, ["build"]));
      assert.equal((await retained(f.root)).candidate_id, id);
    }
    assert.ok(
      (await readdir(join(f.root, ".cache/lgtmd/runs"))).every(
        (name) => !name.startsWith(".run-"),
      ),
    );
  } finally {
    await f.dispose();
  }
});
test("dev reuse and preview never execute flows and enforce public audience and same-origin mutation", async () => {
  const f = await fixture();
  try {
    const id = candidate((await run(f.root, ["build"])).stdout);
    const server = await serve(f.root, ["dev", "--reuse"], "npm");
    try {
      const state = await server.state();
      assert.equal(state.run.retained, true);
      assert.equal(state.candidateId, id);
      assert.equal(JSON.stringify(state).includes("Private note"), false);
      assert.equal(
        (
          await fetch(new URL("__lgtmd/run", server.url), {
            method: "POST",
            body: JSON.stringify({ token: state.token }),
          })
        ).status,
        403,
      );
      assert.equal((await rerun(server)).status, 409);
      await fetch(server.url);
      assert.equal(await readFile(join(f.root, "calls"), "utf8"), "x");
    } finally {
      await server.stop();
    }
    const preview = await serve(f.root, ["preview"]);
    try {
      assert.equal((await fetch(preview.url)).status, 200);
      assert.equal(
        (await fetch(new URL("site.json", preview.url))).status,
        200,
      );
      assert.equal(
        (await fetch(new URL("__lgtmd/state", preview.url))).status,
        404,
      );
    } finally {
      await preview.stop();
    }
    await assert.rejects(
      run(f.root, ["preview", "--audience", "contributor", "--port", "0"]),
    );
    assert.equal(await readFile(join(f.root, "calls"), "utf8"), "x");
  } finally {
    await f.dispose();
  }
});
test("explicit sibling topology and retained commands work after removing authoring sources", async () => {
  const f = await fixture();
  try {
    const docs = join(f.root, "documentation");
    await mkdir(docs);
    const path = join(docs, "lgtmd.config.json");
    await writeFile(
      path,
      JSON.stringify({
        ...f.config,
        flow: { ...f.config.flow, cwd: "..", watch: ["../flow.mjs"] },
        snapshots: "../records",
        cacheDir: "../cache",
        outDir: "../public/docs",
      }),
    );
    const id = candidate(
      (await run(f.root, ["build", "--config", path])).stdout,
    );
    await rm(join(f.root, "flow.mjs"));
    const server = await serve(f.root, ["dev", "--reuse", "--config", path]);
    try {
      assert.equal((await server.state()).candidateId, id);
    } finally {
      await server.stop();
    }
  } finally {
    await f.dispose();
  }
});
test("failed dev runs keep visible stale pages and the same session can recover", async () => {
  const f = await fixture();
  try {
    const server = await serve(f.root, ["dev"]);
    try {
      const success = await waitFor(
        server.state,
        (state) => state.run.status === "succeeded",
      );
      await writeFile(
        join(f.root, "flow.mjs"),
        "throw new Error('deliberate failure')",
      );
      await rerun(server);
      const failed = await waitFor(
        server.state,
        (state) => state.run.status === "failed",
      );
      assert.equal(failed.run.stale, true);
      assert.equal(failed.candidateId, success.candidateId);
      await writeFile(join(f.root, "flow.mjs"), f.source);
      await rerun(server);
      assert.equal(
        (
          await waitFor(
            server.state,
            (state) => state.run.status === "succeeded",
          )
        ).run.stale,
        false,
      );
    } finally {
      await server.stop();
    }
  } finally {
    await f.dispose();
  }
});
test("reviewed-candidate acceptance does not rerun, exact check detects drift and preserves snapshots", async () => {
  const f = await fixture();
  try {
    const id = candidate((await run(f.root, ["build"])).stdout);
    await run(f.root, ["update", "--candidate", id], "npm");
    assert.equal(await readFile(join(f.root, "calls"), "utf8"), "x");
    await run(f.root, ["check"]);
    const before = await readFile(
      join(f.root, "docs/snapshots/reader/bundle.json"),
    );
    await writeFile(
      join(f.root, "flow.mjs"),
      f.source.replace("Visible text", "Changed text"),
    );
    await assert.rejects(run(f.root, ["check"]));
    assert.deepEqual(
      await readFile(join(f.root, "docs/snapshots/reader/bundle.json")),
      before,
    );
    await assert.rejects(
      run(f.root, ["update", "--candidate", "0".repeat(64)]),
    );
    assert.equal(await readFile(join(f.root, "calls"), "utf8"), "xxx");
  } finally {
    await f.dispose();
  }
});
test("watch coalesces writes, ignores output and survives repeated atomic editor saves", async () => {
  const f = await fixture();
  try {
    const server = await serve(f.root, ["dev", "--watch"]);
    try {
      await waitFor(server.state, (state) => state.run.status === "succeeded");
      for (let i = 1; i <= 2; i++) {
        const temp = join(f.root, `save-${i}.tmp`);
        await writeFile(temp, f.source.replace("Visible text", `Version ${i}`));
        await rename(temp, join(f.root, "flow.mjs"));
        await waitFor(
          async () => await readFile(join(f.root, "calls"), "utf8"),
          (calls) => calls.length === i + 1,
        );
        await waitFor(
          server.state,
          (state) => state.run.status === "succeeded",
        );
      }
      await writeFile(join(f.root, ".cache/lgtmd/ignored"), "output");
      await pause(500);
      assert.equal((await readFile(join(f.root, "calls"), "utf8")).length, 3);
    } finally {
      await server.stop();
    }
  } finally {
    await f.dispose();
  }
});
test("edits during a run queue only one fresh successor", async () => {
  const f = await fixture();
  try {
    const delayed = `await new Promise(r=>setTimeout(r,500));${f.source}`;
    await writeFile(join(f.root, "flow.mjs"), delayed);
    const server = await serve(f.root, ["dev", "--watch"]);
    try {
      await waitFor(server.state, (state) => state.run.status === "running");
      for (let i = 0; i < 4; i++)
        await writeFile(join(f.root, "flow.mjs"), delayed + `\n// edit ${i}`);
      await waitFor(
        async () => readFile(join(f.root, "calls"), "utf8").catch(() => ""),
        (calls) => calls.length === 2,
      );
      await waitFor(server.state, (state) => state.run.status === "succeeded");
      await pause(400);
      assert.equal(await readFile(join(f.root, "calls"), "utf8"), "xx");
    } finally {
      await server.stop();
    }
  } finally {
    await f.dispose();
  }
});
test("Git exact-object review preserves worktree/index and reports absent histories honestly", async () => {
  const f = await fixture();
  try {
    const id = candidate((await run(f.root, ["build"])).stdout);
    await git(f.root, ["init", "--quiet"]);
    await writeFile(join(f.root, ".gitignore"), ".cache/\nbuild/\n");
    await git(f.root, ["add", "."]);
    await git(f.root, ["commit", "--quiet", "-m", "Initial"]);
    const missing = await serve(f.root, ["dev", "--reuse"]);
    try {
      const state = await waitFor(
        missing.state,
        (s) => s.baseline.status !== "loading" && !!s.history,
      );
      assert.equal(state.baseline.status, "unavailable");
      assert.match(state.baseline.message ?? "", /No recorded/i);
      assert.equal(state.baseline.code, "missing-snapshot");
      assert.equal(state.baseline.commit?.subject, "Initial");
      assert.deepEqual(
        state.history?.commits.map((c) => c.subject),
        ["Initial"],
      );
      assert.equal(state.history?.message, undefined);
    } finally {
      await missing.stop();
    }
    await run(f.root, ["update", "--candidate", id]);
    await git(f.root, ["add", "docs"]);
    await git(f.root, ["commit", "--quiet", "-m", "Record"]);
    const before = (await git(f.root, ["status", "--porcelain=v1"])).stdout;
    const sha = (await git(f.root, ["rev-parse", "HEAD"])).stdout.trim();
    const server = await serve(f.root, ["dev", "--reuse"]);
    try {
      const state = await waitFor(
        server.state,
        (s) => s.baseline.status === "available" && !!s.history,
      );
      assert.equal(state.baseline.revision, sha);
      assert.equal(state.baseline.commit?.subject, "Record");
      assert.equal(state.baseline.commit?.revision, sha);
      assert.ok(Number.isInteger(state.baseline.commit?.committedAt));
      assert.match(state.baseline.commit?.decorations ?? "", /HEAD/);
      assert.deepEqual(
        state.history?.commits.map((c) => c.subject),
        ["Record", "Initial"],
      );
      assert.equal(state.history?.truncated, false);
      assert.ok(state.comparison);
      await fetch(new URL("__lgtmd/base", server.url), {
        method: "POST",
        headers: { Origin: new URL(server.url).origin },
        body: JSON.stringify({ token: state.token, ref: "unknown-ref" }),
      });
      assert.equal((await server.state()).baseline.status, "unavailable");
      await fetch(new URL("__lgtmd/base", server.url), {
        method: "POST",
        headers: { Origin: new URL(server.url).origin },
        body: JSON.stringify({ token: state.token, ref: id }),
      });
      const confused = await server.state();
      assert.equal(confused.baseline.code, "candidate-id");
      assert.match(
        confused.baseline.message ?? "",
        /candidate ID, not a Git revision/,
      );
      assert.equal(confused.comparison, undefined);
      assert.equal(confused.history?.commits[0]?.subject, "Record");
    } finally {
      await server.stop();
    }
    assert.equal(
      (await git(f.root, ["status", "--porcelain=v1"])).stdout,
      before,
    );
  } finally {
    await f.dispose();
  }
});
test("normal startup displays retained output while fresh execution fails", async () => {
  const f = await fixture();
  try {
    const id = candidate((await run(f.root, ["build"])).stdout);
    await writeFile(
      join(f.root, "flow.mjs"),
      "await new Promise(r=>setTimeout(r,500));throw new Error('fresh failure');",
    );
    const server = await serve(f.root, ["dev"], "npm");
    try {
      const running = await server.state();
      assert.equal(running.run.status, "running");
      assert.equal(running.run.stale, true);
      assert.equal(running.candidateId, id);
      const failed = await waitFor(
        server.state,
        (s) => s.run.status === "failed",
      );
      assert.equal(failed.candidateId, id);
    } finally {
      await server.stop();
    }
  } finally {
    await f.dispose();
  }
});
test("npm signal forwarding stops native execution and owned flow descendants", async () => {
  const f = await fixture();
  try {
    const id = candidate((await run(f.root, ["build"])).stdout);
    await writeFile(
      join(f.root, "flow.mjs"),
      `import{spawn}from'node:child_process';import{writeFile}from'node:fs/promises';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await writeFile('descendant',String(child.pid));setInterval(()=>{},1000);`,
    );
    const server = await serve(f.root, ["dev"], "npm");
    await waitFor(
      async () => readFile(join(f.root, "descendant"), "utf8").catch(() => ""),
      (s) => !!s,
    );
    const pid = Number(await readFile(join(f.root, "descendant"), "utf8"));
    assert.deepEqual(await server.stop(), { code: 143, signal: null });
    await waitFor(async () => {
      try {
        process.kill(pid, 0);
        return false;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ESRCH";
      }
    }, Boolean);
    assert.equal((await retained(f.root)).candidate_id, id);
  } finally {
    await f.dispose();
  }
});

test("native and npm preserve SIGINT exit status without executing retained flows", async () => {
  const f = await fixture();
  try {
    await run(f.root, ["build"]);
    for (const mode of ["native", "npm"] as const) {
      const server = await serve(f.root, ["dev", "--reuse"], mode);
      assert.deepEqual(await server.stop("SIGINT"), {
        code: 130,
        signal: null,
      });
    }
    assert.equal(await readFile(join(f.root, "calls"), "utf8"), "x");
  } finally {
    await f.dispose();
  }
});
test("invalid watch roots fail promptly before a server or authoring run starts", async () => {
  const f = await fixture();
  try {
    await writeFile(
      f.path,
      JSON.stringify({
        ...f.config,
        flow: { ...f.config.flow, watch: ["does-not-exist"] },
      }),
    );
    await assert.rejects(run(f.root, ["dev", "--watch"]), (error: unknown) => {
      const failure = error as {
        code: unknown;
        killed?: boolean;
        stdout: string;
      };
      assert.equal(failure.killed, false);
      assert.equal(failure.code, 1);
      assert.equal(
        events(failure.stdout).some((e) => e.event === "listening"),
        false,
      );
      return true;
    });
    await assert.rejects(readFile(join(f.root, "calls")), { code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});
test("normal startup rejects corrupted retained output and can recover through a fresh run", async () => {
  const f = await fixture();
  try {
    const id = candidate((await run(f.root, ["build"])).stdout);
    await writeFile(
      join(f.root, ".cache/lgtmd/candidates", id, "candidate.json"),
      "broken JSON",
    );
    await writeFile(
      join(f.root, "flow.mjs"),
      f.source.replace("Visible text", "Fresh valid text"),
    );
    const server = await serve(f.root, ["dev"]);
    try {
      const state = await waitFor(
        server.state,
        (s) => s.run.status === "succeeded",
      );
      assert.notEqual(state.candidateId, id);
      assert.equal(state.run.stale, false);
    } finally {
      await server.stop();
    }
  } finally {
    await f.dispose();
  }
});
test("many Git revisions retain current resource bytes and coherent comparison state", async () => {
  const f = await fixture();
  try {
    await git(f.root, ["init", "--quiet"]);
    for (let i = 0; i < 21; i++) {
      await writeFile(
        join(f.root, "flow.mjs"),
        f.source.replace("Visible text", `Version ${i}`),
      );
      const id = candidate((await run(f.root, ["build"])).stdout);
      await run(f.root, ["update", "--candidate", id]);
      await git(f.root, ["add", "docs"]);
      await git(f.root, ["commit", "--quiet", "-m", `Version ${i}`]);
    }
    await git(f.root, ["branch", "before", "HEAD~20"]);
    await writeFile(
      join(f.root, "flow.mjs"),
      `import{Doc,completeRun}from ${JSON.stringify(sdk)};const doc=new Doc('hello','Hello');const asset=doc.assets.image('current',Uint8Array.of(1,2,3),{producer:'fixture',profile:'v1'});doc.md\`\${asset.embed('Current version')}\`;await completeRun([doc.finish()]);`,
    );
    await run(f.root, ["build"]);
    const server = await serve(f.root, ["dev", "--reuse"]);
    try {
      const initial = await waitFor(
        server.state,
        (s) =>
          s.baseline.status === "available" && !!s.comparison && !!s.history,
      );
      assert.equal(initial.history?.commits.length, 20);
      assert.equal(initial.history?.truncated, true);
      assert.equal(initial.history?.commits[0]?.subject, "Version 20");
      assert.equal(initial.history?.commits[19]?.subject, "Version 1");
      const historyPage = async (direction: string) => {
        const response = await fetch(new URL("__lgtmd/history", server.url), {
          method: "POST",
          headers: { Origin: new URL(server.url).origin },
          body: JSON.stringify({ token: initial.token, direction }),
        });
        assert.equal(response.status, 200);
        return (await server.state()).history!;
      };
      // Branches moving between requests must not shift the pinned pagination.
      await git(f.root, [
        "commit",
        "--allow-empty",
        "--quiet",
        "-m",
        "Unrelated project change",
      ]);
      const older = await historyPage("older");
      assert.equal(older.offset, 20);
      assert.equal(older.truncated, false);
      assert.deepEqual(
        older.commits.map((c) => c.subject),
        ["Version 0"],
      );
      assert.equal(
        (await server.state()).baseline.revision,
        initial.baseline.revision,
      );
      const newer = await historyPage("newer");
      assert.deepEqual(
        newer.commits.map((c) => c.revision),
        initial.history!.commits.map((c) => c.revision),
      );
      const refreshed = await historyPage("refresh");
      assert.equal(refreshed.commits[0]?.subject, "Unrelated project change");
      // This commit did not touch the snapshot, but still contains its docs.
      await fetch(new URL("__lgtmd/base", server.url), {
        method: "POST",
        headers: { Origin: new URL(server.url).origin },
        body: JSON.stringify({
          token: initial.token,
          ref: refreshed.commits[0]!.revision,
        }),
      });
      assert.equal((await server.state()).baseline.status, "available");
      const refreshedOlder = await historyPage("older");
      assert.deepEqual(
        refreshedOlder.commits.map((c) => c.subject),
        ["Version 1", "Version 0"],
      );
      const unauthorized = await fetch(new URL("__lgtmd/history", server.url), {
        method: "POST",
        body: JSON.stringify({ direction: "refresh" }),
      });
      assert.equal(unauthorized.status, 403);
      for (let i = 1; i < 14; i++) {
        const response = await fetch(new URL("__lgtmd/base", server.url), {
          method: "POST",
          headers: { Origin: new URL(server.url).origin },
          body: JSON.stringify({ token: initial.token, ref: `HEAD~${i}` }),
        });
        assert.equal(response.status, 200);
        const state = await server.state();
        assert.equal(state.baseline.status, "available");
        assert.ok(state.comparison);
      }
      const asset = initial.current!.resources[0]!;
      const resource = await fetch(
        new URL(initial.currentResourceBase + asset.path, server.url),
      );
      assert.equal(resource.status, 200);
      assert.deepEqual(
        [...new Uint8Array(await resource.arrayBuffer())],
        [1, 2, 3],
      );
    } finally {
      await server.stop();
    }
  } finally {
    await f.dispose();
  }
});

test("stalled HTTP downloads cannot prevent preview or active dev flow shutdown", async () => {
  const f = await fixture();
  try {
    await writeFile(
      f.path,
      JSON.stringify({
        ...f.config,
        flow: { ...f.config.flow, timeoutMs: 30000 },
      }),
    );
    await writeFile(
      join(f.root, "flow.mjs"),
      `import{Doc,completeRun}from ${JSON.stringify(sdk)};const doc=new Doc('large','Large download');const asset=doc.assets.file('payload',{bytes:new Uint8Array(8*1024*1024),mediaType:'application/octet-stream',extension:'bin'});doc.md\`\${asset.link('Download resource')}\`;await completeRun([doc.finish()]);`,
    );
    await run(f.root, ["build"]);
    const staticState = JSON.parse(
      await readFile(join(f.root, "build/docs/site.json"), "utf8"),
    ) as State;
    await writeFile(
      join(f.root, "flow.mjs"),
      `import{spawn}from'node:child_process';import{writeFile}from'node:fs/promises';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await writeFile('descendant',String(child.pid));setInterval(()=>{},1000);`,
    );
    for (const command of ["preview", "dev"]) {
      const server = await serve(f.root, [command], "npm");
      let stalled: IncomingMessage | undefined;
      let descendant: number | undefined;
      try {
        const state =
          command === "preview" ? staticState : await server.state();
        if (command === "dev") {
          descendant = Number(
            await waitFor(
              async () =>
                readFile(join(f.root, "descendant"), "utf8").catch(() => ""),
              Boolean,
            ),
          );
          assert.equal((await server.state()).run.status, "running");
        }
        const resource = state.current!.resources[0]!;
        stalled = await new Promise<IncomingMessage>((resolve, reject) => {
          const request = get(
            new URL(state.currentResourceBase + resource.path, server.url),
            { agent: false },
            (response) => {
              request.setTimeout(0);
              response.on("error", () => {});
              response.pause();
              resolve(response);
            },
          );
          request.on("error", reject);
          request.setTimeout(5000, () =>
            request.destroy(new Error("Download headers timed out")),
          );
        });
        assert.equal(stalled.statusCode, 200);
        assert.equal(
          Number(stalled.headers["content-length"]),
          8 * 1024 * 1024,
        );
        await pause(50);
        assert.equal(
          stalled.complete,
          false,
          "The client must still be holding an unfinished response",
        );
        assert.deepEqual(await server.stop(), { code: 143, signal: null });
        if (descendant !== undefined) {
          await waitFor(async () => {
            try {
              process.kill(descendant!, 0);
              return false;
            } catch (error) {
              return (error as NodeJS.ErrnoException).code === "ESRCH";
            }
          }, Boolean);
        }
      } finally {
        stalled?.destroy();
        await server.stop();
      }
    }
  } finally {
    await f.dispose();
  }
});

test("theme overrides preserve candidates and exact checks while static builds freeze CSS", async () => {
  const f = await fixture();
  try {
    const config = { ...f.config, basePath: "/docs/" };
    await writeFile(f.path, JSON.stringify(config));
    const id = candidate((await run(f.root, ["build"])).stdout);
    await run(f.root, ["update", "--candidate", id]);
    const snapshot = await readFile(
      join(f.root, "docs/snapshots/reader/bundle.json"),
    );
    const initial = ":root { --lgtmd-accent: #6d28d9; }\n";
    const changed = ":root { --lgtmd-accent: #166534; }\n";
    await writeFile(join(f.root, "theme.css"), initial);
    await writeFile(
      f.path,
      JSON.stringify({ ...config, theme: { css: "theme.css" } }),
    );
    const dev = await serve(f.root, ["dev", "--reuse"], "npm");
    try {
      assert.equal((await dev.state()).candidateId, id);
      const html = await (await fetch(dev.url)).text();
      const stylesheets = [...html.matchAll(/<link\b[^>]*>/g)]
        .map((match) => match[0])
        .filter((link) => /rel="stylesheet"/.test(link));
      assert.ok(stylesheets.length >= 2, html);
      assert.match(stylesheets.at(-1)!, /data-lgtmd-theme/);
      const url = new URL("lgtmd-theme.css", dev.url);
      const response = await fetch(url);
      assert.match(response.headers.get("content-type") ?? "", /text\/css/);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      assert.equal(await response.text(), initial);
      await writeFile(join(f.root, "theme.css"), changed);
      assert.equal(await (await fetch(url)).text(), changed);
      assert.equal((await dev.state()).candidateId, id);
      assert.equal(await readFile(join(f.root, "calls"), "utf8"), "x");
    } finally {
      await dev.stop();
    }

    // The CSS path is also presentation-only: changing it must retain reuse.
    await rename(join(f.root, "theme.css"), join(f.root, "renamed-theme.css"));
    await writeFile(
      f.path,
      JSON.stringify({ ...config, theme: { css: "renamed-theme.css" } }),
    );
    const renamed = await serve(f.root, ["dev", "--reuse"]);
    try {
      assert.equal((await renamed.state()).candidateId, id);
      assert.equal(
        await (await fetch(new URL("lgtmd-theme.css", renamed.url))).text(),
        changed,
      );
    } finally {
      await renamed.stop();
    }
    assert.equal(candidate((await run(f.root, ["build"])).stdout), id);
    assert.equal((await retained(f.root)).candidate_id, id);
    assert.equal(
      await readFile(join(f.root, "build/docs/lgtmd-theme.css"), "utf8"),
      changed,
    );
    await rm(join(f.root, "renamed-theme.css"));
    const preview = await serve(f.root, ["preview"], "npm");
    try {
      assert.equal(
        await (await fetch(new URL("lgtmd-theme.css", preview.url))).text(),
        changed,
      );
      assert.equal(await readFile(join(f.root, "calls"), "utf8"), "xx");
    } finally {
      await preview.stop();
    }
    await run(f.root, ["check"]);
    await run(f.root, ["update", "--candidate", id]);
    assert.deepEqual(
      await readFile(join(f.root, "docs/snapshots/reader/bundle.json")),
      snapshot,
    );
    assert.equal(await readFile(join(f.root, "calls"), "utf8"), "xxx");
  } finally {
    await f.dispose();
  }
});

test("watch excludes the theme input while still rerunning actual flow inputs", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, "docs"));
    await writeFile(
      join(f.root, "docs/theme.css"),
      ":root { --lgtmd-radius: 4px; }",
    );
    await writeFile(
      f.path,
      JSON.stringify({
        ...f.config,
        flow: { ...f.config.flow, watch: ["docs"] },
        theme: { css: "docs/theme.css" },
      }),
    );
    const server = await serve(f.root, ["dev", "--watch"]);
    try {
      const first = await waitFor(
        server.state,
        (state) => state.run.status === "succeeded",
      );
      const css = ":root { --lgtmd-radius: 12px; }";
      await writeFile(join(f.root, "docs/theme.css"), css);
      await pause(1350);
      assert.equal(await readFile(join(f.root, "calls"), "utf8"), "x");
      assert.equal((await server.state()).candidateId, first.candidateId);
      assert.equal(
        await (await fetch(new URL("lgtmd-theme.css", server.url))).text(),
        css,
      );
      await writeFile(
        join(f.root, "docs/flow-input.txt"),
        "Actual input changed",
      );
      await waitFor(
        async () => readFile(join(f.root, "calls"), "utf8"),
        (calls) => calls === "xx",
      );
      await waitFor(server.state, (state) => state.run.status === "succeeded");
    } finally {
      await server.stop();
    }
  } finally {
    await f.dispose();
  }
});

test("theme input errors fail before authoring without weakening output-path safety", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "safe.css"), ":root {}");
    await symlink(join(f.root, "safe.css"), join(f.root, "alias.css"));
    await mkdir(join(f.root, "directory.css"));
    for (const css of [
      "missing.css",
      "directory.css",
      "alias.css",
      "build/docs/theme.css",
      ".cache/lgtmd/theme.css",
      "docs/snapshots/theme.css",
    ]) {
      await writeFile(f.path, JSON.stringify({ ...f.config, theme: { css } }));
      await assert.rejects(run(f.root, ["build"]));
      await assert.rejects(readFile(join(f.root, "calls")), { code: "ENOENT" });
    }
  } finally {
    await f.dispose();
  }
});
