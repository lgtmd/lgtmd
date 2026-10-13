#!/usr/bin/env node
import { spawn } from "node:child_process";
import { nativeExecutable } from "./native.js";

// Command parsing, configuration, execution, Git, serving and assets all belong
// to the Rust executable. This entry only makes it available through npm's bin.
const child = spawn(nativeExecutable(), process.argv.slice(2), {
  stdio: "inherit",
});
const signals = ["SIGINT", "SIGTERM"] as const;
const forward = new Map<NodeJS.Signals, () => void>();
for (const signal of signals) {
  const handler = () => child.kill(signal);
  forward.set(signal, handler);
  process.on(signal, handler);
}
function cleanup(): void {
  for (const [signal, handler] of forward) process.off(signal, handler);
}
let failed = false;
child.once("error", (error) => {
  failed = true;
  cleanup();
  process.stderr.write(
    `lgtmd native executable unavailable for ${process.platform}-${process.arch}: ${error.message}\n`,
  );
  process.exitCode = 1;
});
child.once("close", (code, signal) => {
  cleanup();
  if (failed) return;
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
