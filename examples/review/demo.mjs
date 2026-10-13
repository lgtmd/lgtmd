import { startDemo } from "./fixture.mjs";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    playground: { type: "boolean", default: false },
    port: { type: "string" },
  },
});
const demo = await startDemo({
  playground: values.playground,
  port: values.port === undefined ? 0 : Number(values.port),
});
console.log(`Review demonstration: ${demo.url}`);
let stopping = false;
async function close() {
  if (stopping) return;
  stopping = true;
  await demo.close();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
