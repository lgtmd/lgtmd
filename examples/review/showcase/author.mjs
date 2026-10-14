import { Doc, compileSite } from "lgtmd";
import { webpProfile } from "../capture.mjs";
export async function authorShowcase(version, images) {
  const revised = version === "revised",
    docs = [],
    navigation = [];
  const page = (id, title) => {
    const doc = new Doc(id, title);
    docs.push(doc);
    navigation.push(id);
    return doc;
  };
  const image = (doc, key, asset, profile = "desktop-1280x800") =>
    doc.assets.image(key, images[asset], {
      mediaType: "image/webp",
      producer: "playwright/chromium+sharp",
      profile: `playwright-1.64.0-${process.platform}-${process.arch}-${profile}-${webpProfile}`,
    });
  let doc = page("welcome", "Start here");
  doc.md`A small, permanent place to explore the lgtmd viewer. Every comparison uses two named, retained versions: **Original** and **Revised**. The same viewer and exact comparison engine power normal project documentation.

No repository history, account, external service or fresh capture is needed to browse. These are deliberate demonstration fixtures, not evidence about a production application.

## Explore the examples

- **Text and code**: words, a typo, Unicode and exact code lines.
- **A full page**: meaningful changes across a complete desktop screen.
- **Four pixels**: an almost identical screen with a tiny, measurable difference.
- **Different dimensions**: honest fallback when captures cannot align.
- **Structured content**: tables, lists, URLs and whitespace.
- **Contributor notes**: comments attached to the explanation.
- **Nothing changed**: identical text and image bytes.

The toolbar switches **Original / Revised**. Image controls belong to each image: slider, side by side, and annotations. Open **Versions** to show only changed pages.

A new page exists only in Revised; a retired page exists only in Original. Missing content stays explicit. Use Light, Dark or System appearance, resize the window, and try keyboard navigation.`;
  doc = page("text", "Text and code");
  doc.md`This page changes prose while retaining each version’s original text. Toggle **View diff** without moving the reading layout.`;
  if (revised)
    doc.md`This paragraph was added above the existing instructions.`;
  doc.md`## A word replacement

Review the **${revised ? "final" : "draft"}** project description before sharing.

## A small correction

Check the ${revised ? "description" : "descripton"} carefully.

## Unicode remains intact

${revised ? "부산" : "서울"} 여행 · ${revised ? "明亮" : "安静"}的小屋 · ${revised ? "👨🏽‍💻" : "👩🏽‍💻"}

## Exact code lines

\`\`\`js
const status = "${revised ? "ready" : "draft"}";
saveProject(status);
\`\`\`

The unchanged second line keeps its ordinary appearance. Selection and copy preserve the original text on the selected side.`;
  doc = page("full-page", "A full page");
  doc.md`Compare a complete desktop workspace, captured at **1280px wide**, including the full page height. The revised fixture changes the completed-task count, the final chart bar and the project status. Header, navigation and surrounding context stay in the capture.

${image(doc, "workspace", revised ? "workspace-revised" : "workspace-original").embed("Full desktop workspace with navigation, metrics, activity and projects")}

Use the slider to inspect changes in place. Side by side preserves image proportions and scrolls horizontally. Annotations group changed pixels; they do not identify product semantics.`;
  doc = page("four-pixels", "Four pixels");
  doc.md`These full-width captures look almost identical. A **2 × 2 pixel** marker near the top-right changes color: exactly **four pixels** at the original capture resolution. The rest of the screen is byte-for-byte identical after decoding.

${image(doc, "tiny-change", revised ? "pixels-revised" : "workspace-original").embed("Full desktop workspace with a deliberately tiny four-pixel difference")}

Open the image controls and enable **Annotations**, then open **Details** to see the changed-pixel count. Region boxes are coarser than individual pixels. Exact comparison reports a changed asset even when the change is hard to see at reading size.`;
  doc = page("dimensions", "Different dimensions");
  doc.md`Both images capture the entire page width. Original uses a **1280px** viewport; Revised uses **1100px**. This is an intentional responsive-layout comparison, not a pixel-aligned pair.

${image(doc, "responsive", revised ? "narrow" : "workspace-original", revised ? "desktop-1100x800" : "desktop-1280x800").embed("Complete workspace at two different viewport widths")}

The viewer keeps both captures readable with side-by-side review. It explains why aligned comparison is unavailable instead of inventing meaningful pixel annotations.`;
  doc = page("structure", "Structured content");
  doc.md`Complex structures receive whole-block markers. The viewer does not pretend that table cells or list items have stable identities.

## A table

| Stage | Owner |
| --- | --- |
| ${revised ? "Review" : "Draft"} | Alex |
| Delivery | Morgan |

## A list

- Prepare the brief.
- ${revised ? "Approve" : "Review"} the proposal.
- Share the result.

## Same label, different destination

[Project handbook](https://example.com/${revised ? "handbook-v2" : "handbook-v1"})

## Whitespace matters

\`\`\`js
${revised ? "  " : ""}saveProject();
\`\`\`

## Repeated passages

Repeated explanation.

${revised ? "Updated explanation." : "Repeated explanation."}

Repeated passages can be ambiguous. A whole-block indication is more honest than guessing which paragraph the author meant.`;
  doc = page("notes", "Contributor notes");
  const passage = doc.md`Notes keep implementation details alongside the explanation without interrupting ordinary reading. Open the small comment button to read a note.

This visible passage stays the same in both versions.`;
  doc.noteOn(
    passage,
  )`Public sample note: ${revised ? "the revised fixture includes the completed review" : "the original fixture is awaiting review"}. This is deliberately public demo content.`;
  doc.md`Contributor notes are excluded from Reader bundles before delivery. This showcase defaults to Contributor so you can inspect the comment behavior. Start it with **--audience reader** to inspect the filtered version. Note changes keep their normal presentation and report partial detailed-text coverage.`;
  doc = page("unchanged", "Nothing changed");
  doc.md`This page and its full-width capture are identical in both versions. Enable **Changed pages** in Versions to hide it from navigation. Enabling diff should introduce no text highlights or changed-region claims.

${image(doc, "identical", "workspace-original").embed("Unchanged full desktop workspace")}`;
  if (revised) {
    doc = page("new-page", "A new page");
    doc.md`This entire page was added in Revised. Switch to Original to see an explicit missing-side message. The viewer never fills that gap with current content.`;
  } else {
    doc = page("retired-page", "A retired page");
    doc.md`This page existed in Original and was removed in Revised. It remains reachable while diff is enabled so the old explanation can still be reviewed.`;
  }
  return compileSite(
    docs.map((doc) => doc.finish()),
    { title: "lgtmd viewer showcase", navigation },
  );
}
