import { guide } from "lgtmd";
import { explainRecordNames } from "./shared.ts";

export default guide(
  { id: "record-names", title: "Choose useful record names" },
  (doc) => {
    const introduction = doc.md`
      A record's name helps you recognize it in the list. Include words that
      describe the work, such as the project and the kind of document.

      Names like **Alpha contract** and **Alpha renewal** share a project name
      while distinguishing the work. Each record also has an identifier for
      referring to it in an export.
    `;

    explainRecordNames(doc);

    doc.noteOn(introduction)`
      This page explains naming. It does not run the application or record an
      executed check. The browser document separately exercises name filtering.
    `;
  },
);
