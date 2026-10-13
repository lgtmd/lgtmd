import { completeRun } from "lgtmd";
import { collectReview } from "./collect.mjs";
await completeRun(
  await collectReview(process.env.REVIEW_VERSION === "A" ? "A" : "B", {
    playground: process.argv.includes("--playground"),
  }),
);
