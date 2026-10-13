export interface RecordEntry {
  id: string;
  name: string;
}

/** Application-owned input reused by standalone preparation and browser fixtures. */
export const exampleRecords: RecordEntry[] = [
  { id: "alpha-contract", name: "Alpha contract" },
  { id: "alpha-renewal", name: "Alpha renewal" },
  { id: "beta-proposal", name: "Beta proposal" },
];
