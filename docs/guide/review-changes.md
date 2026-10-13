# Review text and image changes

<a id="block-0001"></a>

Choose **View diff** to compare your current completed guide with its recorded version in Git. By default the baseline is the exact snapshot at **HEAD**. Select another revision to inspect an earlier result.

The site shows the resolved revision and current candidate. Selecting a version does not check out old code, run your app, or accept a baseline.

## Read both versions

Use **Previous** and **Current** to read the rendered guide. Changed-page navigation identifies additions, removals and changes. This first version compares whole pages; it does not infer paragraph identity or promise inline word highlighting.

## Compare the screenshots

**Before / After** displays the retained captures side by side. This real example changes the project status from **In progress** to **Ready for review** in both its explanation and screenshot.

![Before and after captures of a project's review status](assets/review-changes/before-after.webp)

Choose **Regions** to outline groups of changed pixels on compatible static PNG or WebP screenshots.

![Changed regions outlined on the current project screenshot](assets/review-changes/changed-regions.webp)

Boxes group changed pixels; they do not recognize semantic controls. Different dimensions or capture profiles, animations, unsupported formats and large images retain the side-by-side view with an explanation. Visual modes never change the exact artifact check result.

## Keep history honest

A revision with no recorded snapshot is reported as unavailable. The site does not recreate historical evidence by running old code. Missing resources and incompatible snapshots remain visible errors; current docs stay readable.

Start with **Reader** for user-facing content. An explicit Contributor session can show attached internal notes, and needs actual Contributor snapshots on both sides to review them.

## Try the demonstration

In a prepared lgtmd checkout, run **just docs-demo**. It starts this real comparison against a disposable, clearly labeled example history. Its sample notes are intentionally public. The example never creates commits in your project.

This page is itself authored with lgtmd. Its browser scenario asserts the real revision and changes, operates the comparison controls, then captures these images. The final guide is not an input to the example it explains.

