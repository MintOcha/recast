import { TARGETS, LIMITS, anySource } from "./config.js";
import { loadSettings, saveSettings } from "./settings.js";
import { convert } from "./convert.js";
import { h, ring, sourcePicker, targetPicker, formatBytes } from "./ui.js";

let settings = await loadSettings();
const persist = () => saveSettings(settings).then((clean) => (settings = clean));

const sampleUrl = new URL("./assets/sample.jpg", import.meta.url).href;
const sample = fetch(sampleUrl).then((r) => r.blob());

// ---- Rules -----------------------------------------------------------------------

const ruleList = document.getElementById("rules");

function renderRules() {
  ruleList.replaceChildren(
    ...settings.rules.map((rule, index) =>
      h("li", { class: "rule" },
        sourcePicker(rule, () => {
          if (rule.from.length) persist();
        }),
        h("span", { class: "arrow", "aria-label": "converts to" }, "→"),
        targetPicker(rule, settings.quality, () => {
          persist();
          renderQuality();
        }),
        h("button", {
          type: "button",
          class: "remove",
          "aria-label": "Remove rule",
          onclick: () => {
            settings.rules.splice(index, 1);
            persist();
            renderRules();
            renderQuality();
          },
        }, "✕"),
      ),
    ),
  );
}

document.getElementById("add-rule").addEventListener("click", () => {
  settings.rules.push({ from: [anySource("image")], to: "webp" });
  persist();
  renderRules();
  renderQuality();
  ruleList.lastElementChild.querySelector("summary").focus();
});

// ---- Quality cards with split preview ------------------------------------------------

const qualityList = document.getElementById("quality");
const previews = new Map();
const PREVIEW_SAMPLE = { seconds: 1, fps: 1, maxWidth: 960 };

function sizeChange(before, after) {
  const percent = Math.round(Math.abs(1 - after / before) * 100);
  return after <= before ? `${percent}% smaller` : `${percent}% larger`;
}

function previewFor(id, quality) {
  const key = `${id}@${quality}`;
  if (!previews.has(key)) {
    previews.set(key, sample.then((blob) =>
      convert({ blob, kind: "image" }, id, { quality: { [id]: quality }, animation: PREVIEW_SAMPLE })));
  }
  return previews.get(key);
}

function qualityCard(id) {
  const target = TARGETS[id];
  const value = h("output", { class: "value" }, target.quality ? `${settings.quality[id]}%` : "Lossless");
  const ringSlot = h("span", { class: "ring-slot" }, ring(settings.quality[id], !target.quality));
  const result = target.video
    ? h("video", { class: "after", muted: true, playsinline: true, "aria-label": `${target.label} result` })
    : h("img", { class: "after", alt: `${target.label} result` });
  const stage = h("div", { class: "stage" },
    h("img", { class: "before", src: sampleUrl, alt: "Original" }),
    result,
    h("span", { class: "tag tag-before" }, "Original"),
    h("span", { class: "tag tag-after" }, target.label),
  );
  const split = h("input", {
    type: "range", min: 0, max: 100, value: 50, class: "split", "aria-label": "Compare original and result",
    oninput: (e) => stage.style.setProperty("--split", `${e.target.value}%`),
  });
  stage.append(split, h("span", { class: "handle", "aria-hidden": "true" }));
  const size = h("p", { class: "size" }, "Rendering preview…");

  let shown;
  let token = 0;
  async function refresh() {
    const quality = settings.quality[id];
    const mine = ++token;
    stage.classList.add("busy");
    try {
      const [original, blob] = await Promise.all([sample, previewFor(id, quality)]);
      if (mine !== token) return;
      if (shown) URL.revokeObjectURL(shown);
      shown = URL.createObjectURL(blob);
      result.src = shown;
      size.textContent = target.animated || target.video
        ? `One frame of the sample at ${quality}%. Clips scale with length and motion.`
        : `${formatBytes(original.size)} → ${formatBytes(blob.size)} · ${sizeChange(original.size, blob.size)}`;
    } catch (error) {
      if (mine === token) size.textContent = `Preview unavailable: ${error.message}`;
    } finally {
      if (mine === token) stage.classList.remove("busy");
    }
  }

  let wait;
  const slider = target.quality && h("input", {
    type: "range", class: "quality", min: LIMITS.quality.min, max: LIMITS.quality.max, value: settings.quality[id],
    "aria-label": `${target.label} quality`,
    oninput: (e) => {
      settings.quality[id] = Number(e.target.value);
      value.textContent = `${settings.quality[id]}%`;
      e.target.style.setProperty("--fill", `${settings.quality[id]}%`);
      ringSlot.replaceChildren(ring(settings.quality[id]));
      clearTimeout(wait);
      wait = setTimeout(() => {
        persist();
        refresh();
        renderRuleLabels();
      }, 180);
    },
  });
  if (slider) slider.style.setProperty("--fill", `${settings.quality[id]}%`);

  refresh();
  return h("li", { class: "card" },
    h("header", {}, ringSlot, h("h3", {}, target.label), value),
    slider,
    stage,
    size,
  );
}

function renderQuality() {
  const used = [...new Set(settings.rules.map((r) => r.to))];
  qualityList.replaceChildren(...used.map(qualityCard));
}

/** Updates rule buttons in place after a quality change, without closing open pickers. */
function renderRuleLabels() {
  if (!document.querySelector(".cascade[open]")) renderRules();
}

// ---- Clip and folder --------------------------------------------------------------------

function bindNumber(id, key) {
  const input = document.getElementById(id);
  Object.assign(input, { min: LIMITS[key].min, max: LIMITS[key].max, value: settings.animation[key] });
  input.addEventListener("change", async () => {
    settings.animation[key] = Number(input.value);
    await persist();
    input.value = settings.animation[key];
  });
}
bindNumber("seconds", "seconds");
bindNumber("fps", "fps");
bindNumber("max-width", "maxWidth");

const folder = document.getElementById("folder");
folder.value = settings.folder;
folder.addEventListener("change", async () => {
  settings.folder = folder.value.trim();
  await persist();
  folder.value = settings.folder;
});

document.getElementById("reset").addEventListener("click", async () => {
  await browser.storage.local.clear();
  location.reload();
});

renderRules();
renderQuality();
