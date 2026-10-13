import { startDemo } from "./fixture.mjs";
const demo = await startDemo();
console.log(`Review demonstration: ${demo.url}`);
let stopping = false;
async function close() {
  if (stopping) return;
  stopping = true;
  await demo.close();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
