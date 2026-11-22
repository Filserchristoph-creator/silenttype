import { SilentTypeApp } from "./ui/app.ts";

const root = document.getElementById("app");
if (!root) throw new Error("#app element not found");

const app = new SilentTypeApp(root);
app.mount().catch((e) => {
  console.error(e);
  root.innerHTML = `<div style="padding:24px;color:#f5f5f7">
    <h2>Fehler beim Start</h2>
    <pre style="white-space:pre-wrap;color:#ff453a">${String(e)}</pre>
  </div>`;
});
