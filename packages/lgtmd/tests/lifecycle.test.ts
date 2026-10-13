import assert from "node:assert/strict";
import test from "node:test";
import {
  guide,
  GuideRunError,
  runGuide,
  runGuideWithContext,
} from "../src/lifecycle.js";

test("declaring a guide does not execute it and execution cleans up before returning", async () => {
  const order: string[] = [];
  const definition = guide(
    {
      id: "prepared",
      title: "Prepared",
      prepare: async () => {
        order.push("prepare");
        return {
          context: { count: 3 },
          cleanup: async () => {
            order.push("cleanup");
          },
        };
      },
    },
    (doc, context) => {
      order.push("write");
      doc.md`There are ${context.count} records.`;
    },
  );
  assert.equal(order.length, 0);
  const document = await runGuide(definition);
  order.push("returned");
  assert.deepEqual(order, ["prepare", "write", "cleanup", "returned"]);
  assert.equal(document.id, "prepared");
  assert.deepEqual(document.checks, []);
});

test("partial preparation failure remains project-owned", async () => {
  const error = new Error("Preparation failed before context acquisition");
  let wrote = false;
  const definition = guide(
    {
      id: "partial",
      title: "Partial",
      prepare: async () => {
        throw error;
      },
    },
    () => {
      wrote = true;
    },
  );
  await assert.rejects(
    runGuide(definition),
    (candidate) => candidate === error,
  );
  assert.equal(wrote, false);
});

test("successful acquisition runs cleanup exactly once after an authoring failure", async () => {
  const error = new Error("Write failed");
  let cleanups = 0;
  const definition = guide(
    {
      id: "write-failure",
      title: "Write failure",
      prepare: () => ({
        context: undefined,
        cleanup: () => {
          cleanups += 1;
        },
      }),
    },
    () => {
      throw error;
    },
  );
  await assert.rejects(
    runGuide(definition),
    (candidate) => candidate === error,
  );
  assert.equal(cleanups, 1);
});

test("primary and cleanup failures retain both original errors", async () => {
  const primary = new Error("Authoring failed");
  const cleanup = new Error("Cleanup failed");
  const definition = guide(
    {
      id: "both",
      title: "Both failures",
      prepare: () => ({
        context: null,
        cleanup: () => {
          throw cleanup;
        },
      }),
    },
    () => {
      throw primary;
    },
  );
  await assert.rejects(runGuide(definition), (candidate) => {
    assert.ok(candidate instanceof GuideRunError);
    assert.deepEqual(candidate.errors, [primary, cleanup]);
    assert.equal(candidate.primary, primary);
    assert.equal(candidate.cleanup, cleanup);
    return true;
  });
});

test("cleanup failure prevents otherwise successful output", async () => {
  const cleanup = new Error("Cleanup failed");
  const definition = guide(
    {
      id: "cleanup",
      title: "Cleanup",
      prepare: () => ({
        context: 3,
        cleanup: () => {
          throw cleanup;
        },
      }),
    },
    (doc) => {
      doc.md`Successful authoring.`;
    },
  );
  await assert.rejects(
    runGuide(definition),
    (candidate) => candidate === cleanup,
  );
});

test("swallowed native assertion failure and cleanup failure are both preserved", async () => {
  const primary = new Error("Native assertion failed");
  const cleanup = new Error("Cleanup failed");
  const definition = guide(
    {
      id: "taint",
      title: "Tainted authoring",
      prepare: () => ({
        context: 3,
        cleanup: () => {
          throw cleanup;
        },
      }),
    },
    async (doc) => {
      try {
        await doc.check("failed", () => {
          throw primary;
        });
      } catch {
        /* Deliberately test swallowed errors. */
      }
      doc.md`This prose cannot conceal a failed assertion.`;
    },
  );
  await assert.rejects(runGuide(definition), (candidate) => {
    assert.ok(candidate instanceof GuideRunError);
    assert.ok(candidate.primary instanceof AggregateError);
    assert.equal(candidate.primary.errors[0], primary);
    assert.equal(candidate.cleanup, cleanup);
    return true;
  });
});

test("supplied context has no framework cleanup ownership", async () => {
  let cleanups = 0;
  const context = {
    value: 7,
    cleanup: () => {
      cleanups += 1;
    },
  };
  const document = await runGuideWithContext(
    { id: "supplied", title: "Supplied" },
    context,
    (doc, supplied) => {
      assert.equal(supplied, context);
      doc.md`The supplied value is ${supplied.value}.`;
    },
  );
  assert.equal(document.id, "supplied");
  assert.equal(cleanups, 0);
});

test("declarations copy identity while preparation may omit cleanup", async () => {
  const page = {
    id: "original",
    title: "Original",
    prepare: () => ({ context: 5 }),
  };
  const definition = guide(page, (doc, context) => {
    doc.md`Value: ${context}.`;
  });
  page.id = "changed";
  page.title = "Changed";
  assert.equal((await runGuide(definition)).id, "original");
});

test("cleanup is acquired once even when authoring mutates the preparation result", async () => {
  let original = 0;
  let replacement = 0;
  const prepared = {
    context: 7,
    cleanup: () => {
      original += 1;
    },
  };
  const definition = guide(
    { id: "acquired", title: "Acquired cleanup", prepare: () => prepared },
    (doc) => {
      prepared.cleanup = () => {
        replacement += 1;
      };
      doc.md`Cleanup ownership is already established.`;
    },
  );
  await runGuide(definition);
  assert.equal(original, 1);
  assert.equal(replacement, 0);
});

test("concise expression callbacks author documents without return boilerplate", async () => {
  const definition = guide(
    { id: "concise", title: "Concise authoring" },
    (doc) => doc.md`A useful explanation.`,
  );
  const document = await runGuide(definition);
  assert.equal(document.nodes.length, 1);
  assert.deepEqual(document.checks, []);
});

test("authoring callback return values do not establish verification claims", async () => {
  for (const value of [true, false]) {
    const definition = guide(
      { id: "returned", title: "Returned value" },
      async () => value,
    );
    const document = await runGuide(definition);
    assert.deepEqual(document.nodes, []);
    assert.deepEqual(document.checks, []);
  }
});
