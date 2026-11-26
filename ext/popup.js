import { TARGETS } from "./config.js";
import { loadSettings } from "./settings.js";
import { h, ring, sourceSummary, targetSummary } from "./ui.js";

const { rules, quality } = await loadSettings();

document.getElementById("rules").replaceChildren(
  ...(rules.length
    ? rules.map((r) =>
        h("li", {},
          h("span", { class: "from" }, sourceSummary(r.from)),
          h("span", { class: "arrow" }, "→"),
          ring(quality[r.to], !TARGETS[r.to].quality),
          h("span", { class: "to" }, targetSummary(r.to, quality)),
        ))
    : [h("li", { class: "empty" }, "No rules yet. Add one to see Save as options when you right-click.")]),
);

document.getElementById("edit").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});
