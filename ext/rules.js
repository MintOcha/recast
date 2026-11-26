import { TARGETS, TARGET_GROUPS, LIMITS, anySource } from "./config.js";
import { loadSettings, saveSettings } from "./settings.js";
import { convert } from "./convert.js";
import { h, ring, sourcePicker, targetSummary, formatBytes } from "./ui.js";

const settings = await loadSettings();
const persist = () => saveSettings(settings);

const sampleUrl = new URL("./assets/sample.jpg", import.meta.url).href;
let sample;

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
        h("button", { type: "button", class: "cascade-button output", "aria-haspopup": "dialog",
          onclick: (event) => openOutput(rule, event.currentTarget),
        }, outputLabel(rule)),
        h("button", {
          type: "button",
          class: "remove",
          "aria-label": "Remove rule",
          onclick: () => {
            settings.rules.splice(index, 1);
            persist();
            renderRules();
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
  ruleList.lastElementChild.querySelector("summary").focus();
});

const picker = document.getElementById("output-picker");
const comparison = document.getElementById("comparison");
const formats = document.getElementById("formats");
const apply = document.getElementById("apply-output");
let activeRule, candidate, opener, disposePreview;

function outputLabel(rule) {
  return [ring(settings.quality[rule.to], !TARGETS[rule.to].quality), h("span", {}, targetSummary(rule.to, settings.quality))];
}

function showCandidate(id) {
  if (candidate === id) return;
  candidate = id;
  disposePreview?.();
  disposePreview = showComparison(id);
}

for (const group of TARGET_GROUPS) {
  formats.append(h("h3", {}, group.label), ...group.formats.map(({ id, label }) =>
    h("label", {}, h("input", { type: "radio", name: "format", value: id,
      onchange: () => showCandidate(id),
    }), h("span", {}, label))));
}

function openOutput(rule, button) {
  activeRule = rule;
  opener = button;
  const radio = Array.from(formats.querySelectorAll("input")).find((input) => input.value === rule.to);
  radio.checked = true;
  picker.showModal();
  radio.focus();
  showCandidate(rule.to);
}

apply.addEventListener("click", () => {
  activeRule.to = candidate;
  persist();
  picker.close();
});
document.getElementById("close-output").addEventListener("click", () => picker.close());
picker.addEventListener("close", () => {
  disposePreview?.();
  disposePreview = undefined;
  comparison.replaceChildren();
  candidate = undefined;
  ruleList.querySelectorAll(".output").forEach((button, index) =>
    button.replaceChildren(...outputLabel(settings.rules[index])));
  opener.focus();
});
const PREVIEW_SAMPLE = { seconds: 1, fps: 1, maxWidth: 960 };

function sizeChange(before, after) {
  const percent = Math.round(Math.abs(1 - after / before) * 100);
  return after <= before ? `${percent}% smaller` : `${percent}% larger`;
}

function showComparison(id) {
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
  let wait;
  async function refresh() {
    const quality = settings.quality[id];
    const mine = ++token;
    stage.classList.add("busy");
    try {
      const original = await (sample ??= fetch(sampleUrl).then((response) => response.blob()));
      if (mine !== token || !picker.open) return;
      const blob = await convert({ blob: original, kind: "image" }, id, { quality: { [id]: quality }, animation: PREVIEW_SAMPLE });
      if (mine !== token || !picker.open) return;
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

  const slider = target.quality && h("input", {
    type: "range", class: "quality", min: LIMITS.quality.min, max: LIMITS.quality.max, value: settings.quality[id],
    "aria-label": `${target.label} quality`,
    oninput: (e) => {
      settings.quality[id] = Number(e.target.value);
      value.textContent = `${settings.quality[id]}%`;
      ringSlot.replaceChildren(ring(settings.quality[id]));
      clearTimeout(wait);
      ++token;
      wait = setTimeout(refresh, 180);
    },
    onchange: persist,
  });

  comparison.replaceChildren(
    h("header", {}, ringSlot, h("h3", {}, target.label), value), slider, stage, size,
  );
  refresh();
  return () => {
    ++token;
    clearTimeout(wait);
    if (shown) URL.revokeObjectURL(shown);
  };
}


// ---- Clip and folder --------------------------------------------------------------------

function bindNumber(id, key) {
  const input = document.getElementById(id);
  Object.assign(input, { min: LIMITS[key].min, max: LIMITS[key].max, value: settings.animation[key] });
  input.addEventListener("change", async () => {
    settings.animation[key] = Number(input.value);
    const clean = await persist();
    input.value = settings.animation[key] = clean.animation[key];
  });
}
bindNumber("seconds", "seconds");
bindNumber("fps", "fps");
bindNumber("max-width", "maxWidth");

const folder = document.getElementById("folder");
folder.value = settings.folder;
folder.addEventListener("change", async () => {
  settings.folder = folder.value.trim();
  const clean = await persist();
  folder.value = settings.folder = clean.folder;
});

document.getElementById("reset").addEventListener("click", async () => {
  await browser.storage.local.clear();
  location.reload();
});

renderRules();
