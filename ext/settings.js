import { DEFAULT_SETTINGS, TARGETS, LIMITS } from "./config.js";

const clamp = (value, { min, max }, fallback) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/** Drops unknown fields and out-of-range values so a stale or hand-edited store can never break the menu. */
function normalize(raw = {}) {
  const d = DEFAULT_SETTINGS;
  const rules = Array.isArray(raw.rules)
    ? raw.rules
        .filter((r) => TARGETS[r?.to] && Array.isArray(r.from) && r.from.length)
        .map((r) => ({ from: r.from.filter((s) => typeof s === "string"), to: r.to }))
    : d.rules;
  const quality = Object.fromEntries(
    Object.keys(TARGETS).map((id) => [id, clamp(raw.quality?.[id], LIMITS.quality, d.quality[id])]),
  );
  const a = raw.animation ?? {};
  return {
    folder: typeof raw.folder === "string" ? raw.folder.replace(/^[/\\]+|[/\\]+$/g, "") : d.folder,
    rules,
    quality,
    animation: {
      seconds: clamp(a.seconds, LIMITS.seconds, d.animation.seconds),
      fps: clamp(a.fps, LIMITS.fps, d.animation.fps),
      maxWidth: clamp(a.maxWidth, LIMITS.maxWidth, d.animation.maxWidth),
    },
  };
}

export async function loadSettings() {
  return normalize(await browser.storage.local.get());
}

export async function saveSettings(settings) {
  const clean = normalize(settings);
  await browser.storage.local.set(clean);
  return clean;
}

export function onSettingsChanged(listener) {
  browser.storage.local.onChanged.addListener(() => loadSettings().then(listener));
}
