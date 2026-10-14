# First Node guide

Use this when the consumer has no existing lgtmd runner. It demonstrates a small
normalization function with supplied data; replace that function with an import
from the real application for product documentation. No browser or service is
needed for this example.

For a Node 24 ESM project, install through its existing package manager. With npm:

```sh
npm i -D lgtmd
```

Create `docs/authoring/run.mjs`:

```js
import assert from "node:assert/strict";
import { guide, runGuide, completeRun } from "lgtmd";

function normalizeNames(names) {
  return names.map((name) => name.trim()).filter((name) => name.length > 0);
}

const namesGuide = guide(
  { id: "normalize-names", title: "Normalize imported names" },
  async (doc) => {
    const names = normalizeNames([" Alpha ", "", " Beta", "   "]);
    await doc.check("normalized-names", () => {
      assert.deepEqual(names, ["Alpha", "Beta"]);
    });
    const count = doc.observe("name-count", names.length);
    const result = doc.assets.json("names", names);
    const passage = doc.md`
      Trim surrounding whitespace and discard blank entries before importing
      names. These inputs produce ${count} names:

      ${result.code()}

      ${result.link("Download the normalized names")}
    `;
    doc.noteOn(passage)`The fixture includes empty and whitespace-only entries.`;
  },
);

await completeRun([await runGuide(namesGuide)]);
```

Add `lgtmd.config.json` beside the project's package manifest, or extend the
existing config instead:

```json
{
  "schemaVersion": 1,
  "title": "Import guide",
  "flow": {
    "command": ["node", "docs/authoring/run.mjs"],
    "watch": ["docs/authoring"]
  },
  "snapshots": "docs/snapshots",
  "outDir": "build/docs"
}
```

Paths resolve relative to the config; flow arguments execute without a shell.
Keep generated output separate from authored files and other tools' output. Add
build output and `.cache/lgtmd/` to the project's ignore rules if they are not already
covered. Keep deliberately accepted snapshots tracked.

Run through the installed CLI, which supplies the guarded handoff environment:

```sh
npm exec -- lgtmd build
npm exec -- lgtmd preview
```

Read the generated page and JSON. The Reader site should contain the two names
and no contributor note. Stop the preview when finished. For interactive
authoring, `npm exec -- lgtmd dev` runs the same flow; `--watch` uses the configured
watch paths.

When accepting the reviewed result is authorized, use the candidate ID printed
by the completed run, then verify with a fresh execution:

```sh
npm exec -- lgtmd update --candidate CANDIDATE_ID
npm exec -- lgtmd check
```

Do not execute the runner directly or fill in handoff environment variables.
For Markdown-only integrations that do not use the docs-site CLI, follow the
[`publish` API](https://github.com/lgtmd/lgtmd/blob/main/packages/lgtmd/README.md)
instead of mixing the two lifecycles.
