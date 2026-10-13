/** Real SDK -> native site compiler -> CLI build/preview -> bundled browser UI. */
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium, expect } from "@playwright/test";
import { Doc, compileSite } from "lgtmd";

const cli = fileURLToPath(
  new URL("../../lgtmd/dist/src/cli.js", import.meta.url),
);
const directory = await mkdtemp(join(tmpdir(), "lgtmd-viewer-browser-"));
let browser;
let server;
function child(args) {
  const processChild = spawn(process.execPath, [cli, ...args], {
    cwd: directory,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  processChild.stdout.on("data", (chunk) => {
    output += chunk;
  });
  processChild.stderr.on("data", (chunk) => {
    output += chunk;
  });
  return { child: processChild, output: () => output };
}
async function run(args) {
  const running = child(args);
  const [code] = await once(running.child, "close");
  assert.equal(code, 0, running.output());
}
async function preview(audience) {
  server = child(["preview", "--port", "0", "--audience", audience]);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    for (const line of server.output().split("\n")) {
      try {
        const event = JSON.parse(line);
        if (event.event === "listening") return event.url;
      } catch {
        /* Partial line. */
      }
    }
    if (server.child.exitCode !== null) throw new Error(server.output());
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Preview did not start: ${server.output()}`);
}
async function stop() {
  if (!server) return;
  const value = server;
  server = undefined;
  if (value.child.exitCode === null) {
    value.child.kill("SIGTERM");
    await once(value.child, "close");
  }
}
try {
  const malicious = new Doc("unsafe", "Unsafe URL");
  malicious.md`[Unsafe](javascript:alert(1))`;
  await assert.rejects(
    compileSite([malicious.finish()]),
    /scheme|unsafe|unsupported/i,
  );
  browser = await chromium.launch({ headless: true });
  for (const basePath of ["/", "/docs/"]) {
    const themed = basePath === "/docs/";
    await writeFile(
      join(directory, "theme.css"),
      `
:root { --lgtmd-accent: rgb(114, 42, 152); --lgtmd-radius: 18px; }
:root[data-theme="dark"] { --lgtmd-accent: rgb(207, 160, 231); }
[data-lgtmd-part="toolbar"] { border-bottom-width: 3px; }
`,
    );
    await writeFile(
      join(directory, "lgtmd.config.json"),
      JSON.stringify({
        schemaVersion: 1,
        title: "Resource documentation",
        basePath,
        ...(themed ? { theme: { css: "theme.css" } } : {}),
        flow: {
          command: [
            process.execPath,
            fileURLToPath(new URL("./browser-flow.mjs", import.meta.url)),
          ],
        },
        navigation: ["guide", "second"],
      }),
    );
    for (const audience of ["contributor", "reader"]) {
      await run(["build", "--audience", audience]);
      const runCount = await readFile(join(directory, "runs.txt"), "utf8");
      const url = await preview(audience);
      const page = await browser.newPage({
        viewport: { width: 1200, height: 900 },
        colorScheme: "light",
      });
      const errors = [];
      const external = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("request", (request) => {
        if (request.url().includes("example.invalid"))
          external.push(request.url());
      });
      await page.goto(url);
      const html = page.locator("html");
      const appearance = page.getByRole("combobox", { name: "Color theme" });
      await expect(html).toHaveAttribute("data-theme", "light");
      const foreground = () =>
        page
          .locator('[data-lgtmd-part="shell"]')
          .evaluate((el) => getComputedStyle(el).color);
      const lightForeground = await foreground();
      if (themed) {
        await expect(page.locator('[data-lgtmd-part="toolbar"]')).toHaveCSS(
          "border-bottom-width",
          "3px",
        );
        assert.equal(
          await html.evaluate((el) =>
            getComputedStyle(el).getPropertyValue("--lgtmd-accent").trim(),
          ),
          "rgb(114, 42, 152)",
        );
        assert.equal(
          await html.evaluate((el) =>
            getComputedStyle(el).getPropertyValue("--lgtmd-radius").trim(),
          ),
          "18px",
        );
      }
      await appearance.selectOption("dark");
      await expect(html).toHaveAttribute("data-theme", "dark");
      assert.notEqual(
        await foreground(),
        lightForeground,
        "Dark appearance must actually change rendered token colors",
      );
      if (themed)
        assert.equal(
          await html.evaluate((el) =>
            getComputedStyle(el).getPropertyValue("--lgtmd-accent").trim(),
          ),
          "rgb(207, 160, 231)",
        );
      await page.reload();
      await expect(appearance).toHaveValue("dark");
      await expect(html).toHaveAttribute("data-theme", "dark");
      await appearance.selectOption("system");
      await expect(html).toHaveAttribute("data-theme", "light");
      await page.emulateMedia({ colorScheme: "dark" });
      await expect(html).toHaveAttribute("data-theme", "dark");
      await appearance.selectOption("light");
      await expect(html).toHaveAttribute("data-theme", "light");
      await expect(
        page.getByRole("heading", {
          name: "Working with resources",
          exact: true,
        }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("cell", { name: "Items", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("cell", { name: "7", exact: true }),
      ).toHaveCSS("text-align", "right");
      await expect(page.locator("pre")).toContainText('"enabled": true');
      await expect(
        page.getByRole("img", { name: "Safe SVG diagram" }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page
            .getByRole("img", { name: "Safe SVG diagram" })
            .evaluate((image) => image.naturalWidth),
        )
        .toBe(40);
      await expect(
        page.getByRole("link", { name: "External chart" }),
      ).toHaveAttribute("href", "https://example.invalid/tracker.png");
      await expect(
        page.getByRole("checkbox", { name: "View diff" }),
      ).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Run again" })).toHaveCount(
        0,
      );
      if (audience === "reader") {
        await expect(page.locator("body")).not.toContainText(
          "INTERNAL-NOTE-731",
        );
        const data = await (
          await page.request.get(new URL("site.json", url).href)
        ).text();
        assert.ok(
          !data.includes("INTERNAL-NOTE-731") &&
            !data.includes("PRIVATE-RESOURCE-731") &&
            !data.includes("internal-file"),
        );
      } else {
        await expect(page.locator("body")).toContainText("INTERNAL-NOTE-731");
        await expect(
          page.locator("aside[aria-label='Contributor notes']"),
        ).toHaveCount(2);
        assert.equal(
          await page.locator("p aside").count(),
          0,
          "Notes must attach outside paragraphs",
        );
        await expect(
          page.getByRole("link", { name: "Private fixture" }),
        ).toHaveAttribute("download", /internal-file/);
      }
      for (const [name, fragment] of [
        ["Download JSON", '"count": 7'],
        ["Download HTML", "window.downloadExecuted=true"],
      ]) {
        const downloaded = page.waitForEvent("download");
        await page.getByRole("link", { name, exact: true }).click();
        const download = await downloaded;
        assert.ok(
          (await readFile(await download.path(), "utf8")).includes(fragment),
        );
      }
      assert.deepEqual(
        await page.evaluate(() => [
          window.svgExecuted,
          window.downloadExecuted,
        ]),
        [undefined, undefined],
      );
      await page.getByRole("link", { name: "Jump to resources" }).click();
      await expect(page).toHaveURL(/#\/guide\/resources$/);
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Resources and tables" }),
      ).toBeVisible();
      await page.getByRole("link", { name: "Next page", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Next steps", exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Next steps", exact: true }),
      ).toBeVisible();
      await page.getByRole("link", { name: "Back to resources" }).click();
      await expect(
        page.getByRole("heading", { name: "Resources and tables" }),
      ).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      const navigation = page.getByRole("navigation", {
        name: "Documentation pages",
      });
      await expect(navigation).toBeHidden();
      await page.getByRole("button", { name: "Toggle navigation" }).click();
      await expect(navigation).toBeVisible();
      await navigation
        .getByRole("link", { name: "Next steps", exact: true })
        .press("Enter");
      await expect(navigation).toBeHidden();
      await expect(page.getByRole("main")).toBeFocused();
      await expect(page.getByRole("main")).not.toHaveCSS(
        "outline-style",
        "none",
      );
      await expect(
        page.getByRole("heading", { name: "Next steps", exact: true }),
      ).toBeVisible();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        "Mobile layout must not overflow horizontally",
      );
      assert.equal(
        await readFile(join(directory, "runs.txt"), "utf8"),
        runCount,
        "Preview and navigation must never rerun authoring",
      );
      assert.deepEqual(external, [], "Remote images must remain links");
      assert.deepEqual(errors, [], "Rendering must have no browser errors");
      await page.close();
      await stop();
      console.log(
        `Verified ${audience} content, downloads, notes, SVG isolation and hash navigation at ${basePath}`,
      );
    }
  }
} finally {
  await stop();
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
