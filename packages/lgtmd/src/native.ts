import { fileURLToPath } from "node:url";

/** The npm command and SDK compiler use the same embedded-assets executable. */
export function nativeExecutable(): string {
  return fileURLToPath(
    new URL(
      `../../native/${process.platform}-${process.arch}/lgtmd${process.platform === "win32" ? ".exe" : ""}`,
      import.meta.url,
    ),
  );
}
