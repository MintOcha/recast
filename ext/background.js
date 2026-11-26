import { TARGETS, LIMITS, sourceFormatOf, anySource, ringIcon } from "./config.js";
import { loadSettings, onSettingsChanged } from "./settings.js";
import { convert, releaseEngine } from "./convert.js";

// Listeners register synchronously so Firefox delivers install and menu events from the first moment.
let settings;
const ready = loadSettings().then((s) => (settings = s));
onSettingsChanged((next) => (settings = next));

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") browser.runtime.openOptionsPage();
});

const ROOT = "recast";
const KINDS = { image: "image", video: "video" };

/** Targets whose rules match the clicked media, in rule order, without duplicates. */
function targetsFor(kind, format) {
  const accepted = new Set([anySource(kind), format && `${kind}:${format}`]);
  return [...new Set(settings.rules.filter((r) => r.from.some((s) => accepted.has(s))).map((r) => r.to))];
}

const menuTitle = (id) => {
  const target = TARGETS[id];
  return target.quality ? `Save as ${target.label} · ${settings.quality[id]}%` : `Save as ${target.label}`;
};

browser.menus.create({ id: ROOT, title: "Recast", contexts: ["image", "video"] });
let shownItems = [];

browser.menus.onShown.addListener(async (info) => {
  const kind = KINDS[info.mediaType];
  if (!kind || !info.menuIds.includes(ROOT)) return;
  await ready;
  await Promise.all(shownItems.map((id) => browser.menus.remove(id)));
  const targets = targetsFor(kind, sourceFormatOf(kind, { url: info.srcUrl }));
  shownItems = targets.length ? targets : ["none"];
  for (const id of targets) {
    browser.menus.create({ id, parentId: ROOT, title: menuTitle(id), icons: { 16: ringIcon(TARGETS[id], settings.quality[id]) } });
  }
  if (!targets.length) browser.menus.create({ id: "none", parentId: ROOT, title: "No rules for this file", enabled: false });
  browser.menus.refresh();
});

// ---- Reading the clicked media ------------------------------------------------

async function inPage(tab, frameId, code) {
  await browser.tabs.executeScript(tab.id, { file: "/capture.js", frameId });
  const [result] = await browser.tabs.executeScript(tab.id, { code, frameId });
  return result;
}

async function readMedia(info, tab) {
  const kind = KINDS[info.mediaType];
  const time = kind === "video" ? await inPage(tab, info.frameId, `recastPosition(${info.targetElementId})`) : 0;
  if (info.srcUrl && !info.srcUrl.startsWith("blob:")) {
    const response = await fetch(info.srcUrl, { credentials: "include" }).catch(() => null);
    if (response?.ok) return { kind, time, blob: await response.blob() };
  }
  const captured = await inPage(
    tab,
    info.frameId,
    `recastCapture(${JSON.stringify({ targetElementId: info.targetElementId, recordSeconds: kind === "video" ? Math.min(settings.animation.seconds, LIMITS.recordSeconds) : 0 })})`,
  );
  if (!captured) throw new Error("This media can't be read. It may be protected or no longer on the page.");
  return { kind, time: captured.time, blob: new Blob([captured.bytes], { type: captured.type }) };
}

// ---- Saving ---------------------------------------------------------------------

function baseName(url) {
  const last = decodeURIComponent(new URL(url, "https://x/").pathname.split("/").pop() || "");
  return last.replace(/\.[^.]*$/, "").replace(/[^\w\- ]+/g, "_").slice(0, 80) || "recast";
}

async function save(blob, info, target) {
  const url = URL.createObjectURL(blob);
  const name = baseName(info.srcUrl || info.pageUrl);
  const filename = [settings.folder, `${name}.${target.ext}`].filter(Boolean).join("/");
  const id = await browser.downloads.download({ url, filename, conflictAction: "uniquify" });
  const done = (delta) => {
    if (delta.id !== id || !delta.state || delta.state.current === "in_progress") return;
    browser.downloads.onChanged.removeListener(done);
    URL.revokeObjectURL(url);
  };
  browser.downloads.onChanged.addListener(done);
}

// ---- Job feedback on the toolbar button ----------------------------------------------

const running = new Map();
function showProgress() {
  const values = [...running.values()];
  const text = values.length ? `${Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100)}%` : "";
  browser.browserAction.setBadgeText({ text });
}
browser.browserAction.setBadgeBackgroundColor({ color: "#e0218a" });

let notify = function (title, message) {
  browser.notifications.create({ type: "basic", iconUrl: "icons/icon.svg", title, message });
}

async function saveAs(info, tab) {
  const target = TARGETS[info.menuItemId];
  if (!target) return;
  await ready;
  const job = Symbol();
  running.set(job, 0);
  showProgress();
  try {
    const media = await readMedia(info, tab);
    const blob = await convert(media, info.menuItemId, settings, (p) => {
      running.set(job, p);
      showProgress();
    });
    await save(blob, info, target);
  } catch (error) {
    notify("Recast couldn't save this", error.message || String(error));
  } finally {
    running.delete(job);
    showProgress();
    if (!running.size) releaseEngine();
  }
}
browser.menus.onClicked.addListener(saveAs);
