import { createServer } from "vite";
import { startServer } from "./server/index.ts";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const api = await startServer({ port: 4191 });
let app: Awaited<ReturnType<typeof createServer>> | undefined;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  try {
    await app?.close();
  } finally {
    await api.close();
  }
}
try {
  app = await createServer({ root, configFile: `${root}vite.config.ts` });
  await app.listen();
  console.log("Stay demo: http://127.0.0.1:4300/ (API: http://127.0.0.1:4191)");
  console.log(
    "Fictional stays, in-memory requests, and a scripted AI provider. Choose Guest or Host to try both sides.",
  );
  process.once("SIGINT", () => {
    void close();
  });
  process.once("SIGTERM", () => {
    void close();
  });
} catch (error) {
  await close();
  throw error;
}
