import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
const current = new URLSearchParams(location.search).get("version") !== "A";
function App() {
  const [saved, setSaved] = React.useState(false);
  return (
    <main aria-label="Project card">
      <p className="eyebrow">ACME PROJECTS</p>
      <h1>Website refresh</h1>
      <p>Keep the team moving with one clear next step.</p>
      <div className="row">
        <span className={current ? "badge ready" : "badge"}>
          {current ? "Ready for review" : "In progress"}
        </span>
        <button onClick={() => setSaved(true)}>
          {saved ? "Saved" : "Save project"}
        </button>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
