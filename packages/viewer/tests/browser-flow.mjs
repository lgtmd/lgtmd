import { Doc, completeRun } from "lgtmd";
import { appendFile } from "node:fs/promises";
const doc = new Doc("guide", "Working with resources");
const settings = doc.assets.json("settings", { enabled: true, count: 7 });
const file = doc.assets.file("download", {
  bytes: new TextEncoder().encode(
    "<script>window.downloadExecuted=true</script>",
  ),
  mediaType: "text/html",
  extension: "html",
});
const image = doc.assets.image(
  "diagram",
  new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24"><rect width="40" height="24" fill="#3864be"/><script>window.svgExecuted=true</script></svg>',
  ),
  { mediaType: "image/svg+xml" },
);
const hidden = doc.assets.text("internal-file", "PRIVATE-RESOURCE-731");
const observed = doc.observe("seed-count", 7);
doc.section("resources", "Resources and tables");
const paragraph = doc.md`Use **typed resources** and ordinary prose. Press \`Enter\` to continue. Literal input: ${"<img src=x onerror=alert(1)>"}.`;
doc.noteOn(paragraph)`INTERNAL-NOTE-731 accompanies the paragraph.`;
doc.noteOn(
  observed,
)`The replay seed is internal. ${hidden.link("Private fixture")}`;
doc.md`| Name | Count |
| :--- | ---: |
| Items | 7 |

> A quoted explanation.

${settings.code()}

${settings.link("Download JSON")} and ${file.link("Download HTML")}.

${image.embed("Safe SVG diagram")}

[Jump to resources](guide.md#resources). [Next page](second.md).

![External chart](https://example.invalid/tracker.png)`;
const next = new Doc("second", "Next steps");
next.md`[Back to resources](guide.md#resources).`;
await appendFile("runs.txt", "run\n");
await completeRun([doc.finish(), next.finish()]);
