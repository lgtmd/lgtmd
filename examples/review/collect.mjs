import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
import { collectPlaywright } from "lgtmd/playwright";
const directory = fileURLToPath(new URL(".", import.meta.url));
export async function collectReview(version = "B") {
  const root = resolve(directory, "dist");
  await readFile(resolve(root, "index.html"));
  const server = createServer(async (request, response) => {
    try {
      const name = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      const target = resolve(root, "." + (name === "/" ? "/index.html" : name));
      if (!target.startsWith(root + sep)) {
        response.writeHead(403).end();
        return;
      }
      const bytes = await readFile(target);
      const mime =
        { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[
          extname(target)
        ] ?? "application/octet-stream";
      response.writeHead(200, { "Content-Type": mime }).end(bytes);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const previous = {
    url: process.env.REVIEW_APP_URL,
    version: process.env.REVIEW_VERSION,
  };
  process.env.REVIEW_APP_URL = `http://127.0.0.1:${server.address().port}/`;
  process.env.REVIEW_VERSION = version;
  try {
    return await collectPlaywright({
      config: new URL("./playwright.config.ts", import.meta.url),
      cwd: directory,
    });
  } finally {
    for (const [key, value] of [
      ["REVIEW_APP_URL", previous.url],
      ["REVIEW_VERSION", previous.version],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise((done, reject) => {
      server.close((error) => (error ? reject(error) : done()));
      server.closeAllConnections();
    });
  }
}
