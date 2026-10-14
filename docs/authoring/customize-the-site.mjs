import { guide } from "lgtmd";

export default guide(
  { id: "customize-the-site", title: "Customize the docs site" },
  (doc) => {
    doc.md`Give your docs their own colors, typography and proportions with one CSS file. The bundled site includes Light, Dark and System appearance settings. System follows the reader's device; an explicit choice stays in that browser for this site.

## Add your theme

Add a theme to \`lgtmd.config.json\`:

\`\`\`json
{
  "flow": { "command": ["node", "docs/authoring/run.ts"] },
  "theme": { "css": "docs/theme.css" }
}
\`\`\`

The path resolves relative to the config file and must name a regular UTF-8 file. Create \`docs/theme.css\` with ordinary browser CSS:

\`\`\`css
:root {
  --lgtmd-accent: #6d28d9;
  --lgtmd-accent-foreground: #ffffff;
  --lgtmd-radius: 0.75rem;
  --lgtmd-content-width: 52rem;
}

:root[data-theme="dark"] {
  --lgtmd-accent: #c4b5fd;
  --lgtmd-accent-foreground: #201039;
}
\`\`\`

The site loads your file after its default styles. No Tailwind setup or frontend build is required in your project. The bundled components use Tailwind internally; this file uses CSS values, not Tailwind directives or utility generation.

## Choose the level of customization

Start with the shared tokens. They apply consistently across navigation, articles and review controls:

| Tokens | Controls |
| --- | --- |
| \`--lgtmd-background\`, \`--lgtmd-foreground\` | Page background and text |
| \`--lgtmd-surface\` | Raised and inset surfaces |
| \`--lgtmd-muted\`, \`--lgtmd-muted-foreground\` | Quiet surfaces and secondary text |
| \`--lgtmd-border\` | Dividers and control borders |
| \`--lgtmd-accent\`, \`--lgtmd-accent-foreground\` | Emphasis and its contrasting text |
| \`--lgtmd-font-sans\`, \`--lgtmd-font-mono\` | Reading and code font stacks |
| \`--lgtmd-success\`, \`--lgtmd-warning\`, \`--lgtmd-danger\`, \`--lgtmd-note\` and each \`-surface\` counterpart | Status and contributor-note colors |
| \`--lgtmd-radius\` | Shared corner radius |
| \`--lgtmd-content-width\`, \`--lgtmd-sidebar-width\` | Article and navigation widths |

Use \`:root[data-theme="dark"]\` for dark-specific values. Check contrast, focus visibility, code and screenshots in both appearances before publishing a theme.

For a more focused change, target a supported styling hook:

\`\`\`css
[data-lgtmd-part="prose"] {
  line-height: 1.8;
}

[data-lgtmd-part="code"] {
  border-radius: 0.25rem;
}
\`\`\`

The supported \`data-lgtmd-part\` values are \`shell\`, \`sidebar\`, \`toolbar\`, \`content\`, \`prose\`, \`code\`, \`notes\`, and \`image-comparison\`. Prefer these hooks to generated utility classes or the exact nesting of elements. Hooks describe presentation areas; they do not promise an editable component API. Replacing layout components or adding client behavior remains future work.

Source-development text review also exposes \`text-change\` and \`block-change\`, with \`data-change="added|removed|modified"\`. Their defaults use the success, danger and warning tokens. Keep typography, padding and borders unchanged in these overrides so enabling highlights preserves the document layout. These two hooks are not in the published 0.2.0 viewer.

## Preview and publish

With \`lgtmd dev\` running, edit the configured CSS file and reload the browser. The server reads its latest bytes without running your application or recapturing evidence. Even with \`--watch\`, edits to this theme file do not queue a flow. Restart dev if you change the configured file path.

\`lgtmd build\` copies the CSS into the static site. \`lgtmd preview\` serves that recorded build, even if the source CSS changes or is removed. Rebuild to publish a new theme.

Theme paths and bytes do not change a completed document's identity or invalidate retained output. \`check\`, snapshot acceptance and Git comparisons still concern authored content and evidence. The current theme presents both sides of a comparison; it does not reproduce a historical site's CSS.

Keep overrides self-contained. lgtmd copies only the configured CSS file: it does not follow \`@import\`, copy fonts or images mentioned in \`url()\`, or rewrite their paths. Relative URLs resolve from the served stylesheet; use assets your deployment actually serves, or browser-supported absolute and data URLs. External resources follow the reader's browser and network rules. A missing, unreadable or unsafe theme input makes dev/build fail visibly. CSS syntax is interpreted by the browser; the CLI does not compile or validate stylesheet rules.

This customization is included in the npm 0.2.0 docs-site CLI and is also available from the prepared source checkout.`;
  },
);
