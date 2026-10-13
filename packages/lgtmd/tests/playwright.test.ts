import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runPlaywright } from "../src/playwright/index.js";
import { ReporterGuard } from "../src/playwright/guard.js";

const require = createRequire(import.meta.url);
const playwrightDirectory = dirname(
  require.resolve("@playwright/test/package.json"),
);
const packageDirectory = fileURLToPath(new URL("../../", import.meta.url));

async function project(
  options: {
    source?: string;
    config?: string;
    beforeConfig?: string;
    reporter?: string;
    files?: Record<string, string>;
  } = {},
) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "lgtmd-runner-test-")),
  );
  await mkdir(join(directory, "node_modules", "@playwright"), {
    recursive: true,
  });
  await symlink(
    playwrightDirectory,
    join(directory, "node_modules", "@playwright", "test"),
    "dir",
  );
  await symlink(
    packageDirectory,
    join(directory, "node_modules", "lgtmd"),
    "dir",
  );
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  await writeFile(
    join(directory, "playwright.config.mjs"),
    `
    import { defineConfig } from "@playwright/test";
    import { docsReporter } from "lgtmd/playwright";
    ${options.beforeConfig ?? ""}
    export default defineConfig({
      testDir: ".", testMatch: "case.spec.mjs", workers: 1,
      retries: 0, timeout: 3000, projects: [{name: "one"}],
      reporter: ${options.reporter ?? "docsReporter()"},
      ${options.config ?? ""}
    });
  `,
  );
  await writeFile(
    join(directory, "case.spec.mjs"),
    `
    import {test as base, expect} from "@playwright/test";
    import {withDocs} from "lgtmd/playwright";
    ${
      options.source ??
      `
      const test = withDocs(base);
      test("a documented check", async ({doc}) => {
        doc.page({id: "sample", title: "Sample"});
        doc.md\`The sample is ready.\`;
        expect(2 + 2).toBe(4);
      });
    `
    }
  `,
  );
  for (const [filename, source] of Object.entries(options.files ?? {})) {
    await writeFile(join(directory, filename), source);
  }
  return {
    directory,
    reader: join(directory, "reader"),
    contributor: join(directory, "contributor"),
    run() {
      return runPlaywright({
        config: join(directory, "playwright.config.mjs"),
        command: "build",
        reader: join(directory, "reader"),
        contributor: join(directory, "contributor"),
      });
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

async function assertUnpublished(run: Awaited<ReturnType<typeof project>>) {
  await assert.rejects(stat(run.reader), { code: "ENOENT" });
  await assert.rejects(stat(run.contributor), { code: "ENOENT" });
}

test("reporter guard retains synchronous, asynchronous, malformed, and explicit failing outcomes", async () => {
  const guard = new ReporterGuard([
    {
      onTestBegin() {
        throw new Error("sync failure");
      },
    },
    {
      async onExit() {
        throw new Error("async failure");
      },
    },
    {
      async onEnd() {
        return Object.defineProperty({}, "status", {
          get() {
            throw new Error("reporter result getter failed");
          },
        }) as { status?: "passed" };
      },
    },
    {
      async onEnd() {
        return { status: "failed" as const };
      },
    },
  ]);
  guard.invoke("onTestBegin");
  guard.invoke("onExit");
  guard.invoke("onEnd");
  await guard.settle();
  assert.deepEqual(guard.errors.sort(), [
    "onEnd: Error: reporter result getter failed",
    "onEnd: reporter requested failed status",
    "onExit: Error: async failure",
    "onTestBegin: Error: sync failure",
  ]);
});

test("real Playwright fixture composition publishes only after test and worker cleanup", async () => {
  const run = await project({
    source: `
    import {appendFile} from "node:fs/promises";
    const applicationTest = base.extend({
      workspace: async ({}, use) => {
        await use({name: "Prepared workspace"});
        await appendFile("cleanup.txt", "test cleanup\\n");
      },
      service: [async ({}, use) => {
        await use("running");
        await appendFile("cleanup.txt", "worker cleanup\\n");
      }, {scope: "worker"}],
    });
    const test = withDocs(applicationTest);
    test("native fixtures stay available", async ({workspace, service, doc}) => {
      expect(service).toBe("running");
      doc.page({id: "sample", title: "Sample"});
      doc.md\`Use \${workspace.name}.\`;
      expect(workspace.name).toBe("Prepared workspace");
    });
  `,
  });
  try {
    await run.run();
    assert.equal(
      await readFile(join(run.directory, "cleanup.txt"), "utf8"),
      "test cleanup\nworker cleanup\n",
    );
    assert.match(
      await readFile(join(run.reader, "sample.md"), "utf8"),
      /Prepared workspace/,
    );
  } finally {
    await run.cleanup();
  }
});

test("caught named check failure cannot become accepted browser evidence", async () => {
  const run = await project({
    source: `
    const test = withDocs(base);
    test("caught assertion", async ({doc}) => {
      doc.page({id: "sample", title: "Sample"});
      doc.md\`A claim.\`;
      try { await doc.check("false-claim", () => expect(1).toBe(2)); } catch {}
    });
  `,
  });
  try {
    await assert.rejects(run.run(), /did not finish successfully/);
    await assertUnpublished(run);
  } finally {
    await run.cleanup();
  }
});

for (const [name, source, config, files] of [
  [
    "test fixture teardown",
    `
    const test = withDocs(base.extend({
      context: async ({}, use) => { await use({}); throw new Error("test teardown failed"); },
    }));
    test("test teardown", async ({doc, context}) => {
      doc.page({id: "sample", title: "Sample"}); doc.md\`Candidate.\`; expect(context).toEqual({});
    });
  `,
    "",
    {},
  ],
  [
    "worker fixture teardown",
    `
    const test = withDocs(base.extend({
      service: [async ({}, use) => { await use("ready"); throw new Error("worker teardown failed"); }, {scope: "worker"}],
    }));
    test("worker teardown", async ({doc, service}) => {
      doc.page({id: "sample", title: "Sample"}); doc.md\`Candidate.\`; expect(service).toBe("ready");
    });
  `,
    "",
    {},
  ],
  [
    "global teardown",
    undefined,
    'globalTeardown: "./teardown.mjs",',
    {
      "teardown.mjs":
        'export default async () => { throw new Error("global teardown failed"); };',
    },
  ],
  [
    "test timeout",
    `
    const test = withDocs(base);
    test("timeout", async ({doc}) => {
      doc.page({id: "sample", title: "Sample"}); doc.md\`Candidate.\`;
      await new Promise(resolve => setTimeout(resolve, 500));
    });
  `,
    "timeout: 100,",
    {},
  ],
  [
    "global timeout",
    `
    const test = withDocs(base);
    test("global timeout", async ({doc}) => {
      doc.page({id: "sample", title: "Sample"}); doc.md\`Candidate.\`;
      await new Promise(resolve => setTimeout(resolve, 3000));
    });
  `,
    "timeout: 5000, globalTimeout: 1000,",
    {},
  ],
  [
    "SIGINT interruption",
    `
    const test = withDocs(base);
    test("interrupt the owned runner", async ({doc}) => {
      doc.page({id: "sample", title: "Sample"}); doc.md\`Candidate.\`;
      // Playwright forks this test worker from the CLI owned by runPlaywright.
      setTimeout(() => process.kill(process.ppid, "SIGINT"), 50);
      await new Promise(resolve => setTimeout(resolve, 1000));
    });
  `,
    "",
    {},
  ],
] as const) {
  test(`real Playwright ${name} blocks publication`, async () => {
    const run = await project({ source, config, files });
    try {
      await assert.rejects(run.run(), /did not finish successfully/);
      await assertUnpublished(run);
    } finally {
      await run.cleanup();
    }
  });
}

test("async reporter result inspection failure blocks publication", async () => {
  const run = await project({
    beforeConfig:
      'class BrokenReporter { async onEnd() { return Object.defineProperty({}, "status", {get() {throw new Error("reporter result getter failed");}}); } }',
    reporter: "docsReporter({reporters: [new BrokenReporter()]})",
  });
  try {
    await assert.rejects(run.run(), /did not finish successfully/);
    await assertUnpublished(run);
  } finally {
    await run.cleanup();
  }
});

test("late guarded onExit error blocks publication even when Playwright exits zero", async () => {
  const run = await project({
    beforeConfig:
      'class LateReporter { async onExit() { await Promise.resolve(); throw new Error("late reporter failure"); } }',
    reporter: "docsReporter({reporters: [new LateReporter()]})",
  });
  try {
    await assert.rejects(
      run.run(),
      /completed success receipt:.*[\s\S]*late reporter failure/,
    );
    await assertUnpublished(run);
  } finally {
    await run.cleanup();
  }
});

test("late reporter failure preserves an existing explicitly accepted baseline", async () => {
  const run = await project();
  try {
    await runPlaywright({
      config: join(run.directory, "playwright.config.mjs"),
      command: "update",
      reader: run.reader,
      contributor: run.contributor,
    });
    const readerBefore = await readFile(join(run.reader, "sample.md"));
    const contributorBefore = await readFile(
      join(run.contributor, "sample.md"),
    );
    const configPath = join(run.directory, "playwright.config.mjs");
    const config = await readFile(configPath, "utf8");
    await writeFile(
      configPath,
      config.replace(
        "reporter: docsReporter(),",
        'reporter: docsReporter({reporters: [{async onExit() {throw new Error("late update failure");}}]}),',
      ),
    );
    await assert.rejects(
      runPlaywright({
        config: configPath,
        command: "update",
        reader: run.reader,
        contributor: run.contributor,
      }),
      /late update failure/,
    );
    assert.deepEqual(
      await readFile(join(run.reader, "sample.md")),
      readerBefore,
    );
    assert.deepEqual(
      await readFile(join(run.contributor, "sample.md")),
      contributorBefore,
    );
  } finally {
    await run.cleanup();
  }
});

test("unguarded custom reporter configuration is rejected", async () => {
  const run = await project({
    reporter: '[...docsReporter(), ["./unguarded.mjs"]]',
    files: { "unguarded.mjs": "export default class OtherReporter {}" },
  });
  try {
    await assert.rejects(run.run(), /did not finish successfully/);
    await assertUnpublished(run);
  } finally {
    await run.cleanup();
  }
});

for (const [name, config] of [
  ["retries", "retries: 1,"],
  ["repeated runs", "repeatEach: 2,"],
  ["multiple projects", 'projects: [{name: "one"}, {name: "two"}],'],
  ["shards", "shard: {current: 1, total: 2},"],
] as const) {
  test(`unsupported ${name} fails explicitly`, async () => {
    const run = await project({ config });
    try {
      await assert.rejects(run.run(), /did not finish successfully/);
      await assertUnpublished(run);
    } finally {
      await run.cleanup();
    }
  });
}

test("duplicate page identities are rejected rather than choosing by arrival", async () => {
  const run = await project({
    source: `
    const test = withDocs(base);
    for (const title of ["first", "second"]) test(title, async ({doc}) => {
      doc.page({id: "same", title}); doc.md\`A document.\`;
    });
  `,
  });
  try {
    await assert.rejects(run.run(), /did not finish successfully/);
    await assertUnpublished(run);
  } finally {
    await run.cleanup();
  }
});
