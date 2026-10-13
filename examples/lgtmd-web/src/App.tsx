import { useEffect, useState } from "react";
import type { RecordEntry } from "./records.ts";

function RecordList({ records }: { records: readonly RecordEntry[] }) {
  return (
    <ul aria-label="Records">
      {records.map((record) => (
        <li key={record.id}>{record.name}</li>
      ))}
    </ul>
  );
}

export function App() {
  const [search, setSearch] = useState("");
  const [records, setRecords] = useState<RecordEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const workspace = new URLSearchParams(window.location.search).get(
    "workspace",
  );

  useEffect(() => {
    const controller = new AbortController();
    const endpoint =
      workspace === null
        ? "/api/records"
        : `/api/workspaces/${encodeURIComponent(workspace)}`;

    async function loadRecords() {
      setLoading(true);
      setError(undefined);
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error("The records could not be loaded.");
        const loaded: RecordEntry[] = await response.json();
        if (!controller.signal.aborted) setRecords(loaded);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(
            failure instanceof Error
              ? failure.message
              : "The records could not be loaded.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadRecords();
    return () => controller.abort();
  }, [workspace]);

  const query = search.toLocaleLowerCase("en-US");
  const matches = records.filter((record) =>
    record.name.toLocaleLowerCase("en-US").includes(query),
  );
  const count = loading
    ? "Loading records…"
    : error
      ? "Records unavailable"
      : `${matches.length} of ${records.length} records`;

  return (
    <main>
      <h1>Records</h1>
      <p>Find a record by part of its name.</p>
      <label htmlFor="search">Search records</label>
      <input
        id="search"
        type="search"
        autoComplete="off"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <p id="count" aria-live="polite">
        {count}
      </p>
      <RecordList records={matches} />
      <p id="error" role="alert" hidden={!error}>
        {error}
      </p>
    </main>
  );
}
