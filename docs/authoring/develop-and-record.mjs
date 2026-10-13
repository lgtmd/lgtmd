import { guide } from "lgtmd";
export default guide(
  { id: "develop-and-record", title: "Develop and record guides" },
  (doc) => {
    doc.md`Run the flow, read the result, then record exactly the candidate you reviewed.

## Develop locally

\`\`\`sh
lgtmd dev
\`\`\`

Dev starts a loopback docs site and runs the configured flow once. The server reports progress and keeps the last successful result visibly stale if the next run fails. Use **Run again** for another complete run.

\`\`\`sh
lgtmd dev --watch
lgtmd dev --reuse
\`\`\`

Watch is opt-in and requires \`flow.watch\` paths in the config. It reruns the whole flow after source changes, serializes runs, and refreshes after success. Generated output is excluded. Editing during a run queues one follow-up run.

Reuse opens the last completed candidate without running your app. It labels the output as retained, not freshly verified. It cannot be combined with watch. Reading pages and changing review modes never run a flow.

## Configure your project

\`\`\`json
{
  "schemaVersion": 1,
  "title": "My product",
  "flow": {
    "command": ["node", "docs/authoring/run.ts"],
    "watch": ["docs/authoring", "src"]
  },
  "snapshots": "docs/snapshots",
  "outDir": "build/docs",
  "basePath": "/docs/"
}
\`\`\`

Paths resolve relative to the config file. Use \`--config PATH\` when it is elsewhere. Command arguments are passed directly, without a shell. Your runner owns database seeds, mock providers, servers and browser fixtures; lgtmd does not impose a fullstack topology.

## Record and check

The CLI and dev page identify each completed candidate. Record that exact result:

\`\`\`sh
lgtmd update --candidate CANDIDATE_ID
\`\`\`

Update copies the reviewed Reader snapshot and resources into your configured snapshot directory. It does not rerun the flow or create a Git commit. Commit the source and snapshots through your ordinary Git workflow. An old source commit alone cannot supply screenshots that were never recorded.

\`\`\`sh
lgtmd check
\`\`\`

Check executes a fresh flow and compares its output exactly with the accepted snapshot. Drift and execution failures exit unsuccessfully. Run it in CI using the same capture profile that produced your accepted images.

## Publish the reading site

\`\`\`sh
lgtmd build
lgtmd preview
\`\`\`

Build runs the flow and creates the static Reader site; preview serves those files without execution. Deploy them through your normal hosting workflow. Root hosting and \`/docs/\` both work, with hash-based page links in this first version.

Reader exports exclude contributor-only payloads before delivery. Use \`--audience contributor\` explicitly for internal output. Committing Contributor snapshots exposes their notes to everyone who can read that repository. Secrets already captured in an image cannot be removed by audience filtering.

To change the site's colors, typography and proportions, configure a CSS file with \`theme.css\`. The [customization guide](customize-the-site.md) covers tokens, appearance settings and supported styling hooks.

The public static site is for reading. Git history review runs in the local development site. Building, accepting a snapshot, committing, and deploying remain separate actions.`;
  },
);
