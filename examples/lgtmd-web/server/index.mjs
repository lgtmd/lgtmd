import { randomUUID } from "node:crypto";
import { exampleRecords } from "../src/records.ts";
import { createServer } from "node:http";

const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex === -1 ? 4174 : process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Provide --port with an integer between 1 and 65535");
}

const workspaces = new Map();

function send(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  if (request.method === "GET" && path === "/api/health") {
    send(response, 200, { ready: true });
    return;
  }
  if (request.method === "GET" && path === "/api/records") {
    send(response, 200, exampleRecords);
    return;
  }
  if (request.method === "POST" && path === "/api/workspaces") {
    try {
      let source = "";
      for await (const chunk of request) {
        source += chunk;
        if (source.length > 65536)
          throw new Error("Workspace payload is too large");
      }
      const records = JSON.parse(source);
      if (
        !Array.isArray(records) ||
        !records.every(
          (record) =>
            record &&
            typeof record.id === "string" &&
            typeof record.name === "string",
        )
      )
        throw new Error("Expected records with string id and name fields");
      const id = randomUUID();
      workspaces.set(id, records);
      send(response, 201, { id, path: `/?workspace=${id}` });
    } catch (error) {
      send(response, 400, { error: error.message });
    }
    return;
  }
  const match = /^\/api\/workspaces\/([^/]+)$/.exec(path);
  if (match) {
    const id = match[1];
    if (request.method === "GET" && workspaces.has(id)) {
      send(response, 200, workspaces.get(id));
      return;
    }
    if (request.method === "DELETE" && workspaces.delete(id)) {
      response.writeHead(204);
      response.end();
      return;
    }
  }
  send(response, 404, { error: "Not found" });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Records API listening at http://127.0.0.1:${port}\n`);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
