// Loads a test copy of ext/ into the bundled Firefox, converts real media through every target, screenshots the UI.
// WebDriver BiDi can't open extension tabs, so the copy marks its pages web-accessible and they load in iframes.
import puppeteer from "puppeteer-core";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const screenshotsOnly = process.argv[2] === "--screenshots";
const out = `${root}${screenshotsOnly ? ".smoke/screenshots" : ".smoke"}/`;
const harness = `${out}ext/`;
const only = process.argv.slice(screenshotsOnly ? 3 : 2);
rmSync(out, { recursive: true, force: true });
cpSync(`${root}ext`, harness, { recursive: true });
const manifest = JSON.parse(readFileSync(`${harness}manifest.json`, "utf8"));
manifest.web_accessible_resources = ["*"];
writeFileSync(`${harness}manifest.json`, JSON.stringify(manifest));

const UUID = "4f1c2e3a-0000-4000-8000-000000000001";
const base = `moz-extension://${UUID}`;
const browser = await puppeteer.launch({
  browser: "firefox",
  executablePath: `${root}.browser/firefox/firefox`,
  headless: true,
  protocolTimeout: 300_000,
  extraPrefsFirefox: {
    "xpinstall.signatures.required": false,
    "extensions.webextensions.uuids": JSON.stringify({ [manifest.browser_specific_settings.gecko.id]: UUID }),
  },
});

async function mount(file, width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  page.on("console", (m) => console.log(`[${file}]`, m.type(), m.text()));
  await page.setContent(`<style>body{margin:0}iframe{border:0;width:100vw;height:100vh;display:block}</style><iframe src="${base}/${file}"></iframe>`);
  const handle = await page.waitForSelector("iframe");
  const frame = await handle.contentFrame();
  await frame.waitForFunction(() => document.readyState === "complete");
  return { page, frame };
}

try {
  await browser.installExtension(harness);
  await new Promise((r) => setTimeout(r, 1500));

  const { page, frame } = await mount("rules.html", 1180, 2200);
  if (!only.length) {
    await frame.waitForSelector(".card .size");
    await frame.waitForFunction(() => [...document.querySelectorAll(".size")].every((s) => !s.textContent.startsWith("Rendering")), { timeout: 180000 });
    console.log(await frame.$$eval(".card", (cards) => cards.map((c) => `${c.querySelector("h3").textContent}: ${c.querySelector(".size").textContent}`).join("\n")));
    await page.screenshot({ path: `${out}rules.png` });

    await frame.click(".rule summary");
    await frame.hover(".cascade[open] .cascade-groups li:nth-child(1) button");
    await frame.click(".cascade[open] .cascade-items li:nth-child(2) button");
    await page.screenshot({ path: `${out}picker.png`, clip: { x: 0, y: 0, width: 1180, height: 700 } });
    console.log("picker still open after pick:", await frame.$eval(".rule .cascade", (d) => d.open));
  }

  if (!screenshotsOnly) {
    const video = readFileSync(`${root}design/test.mp4`).toString("base64");
    const { TARGETS } = await frame.evaluate(async () => ({ TARGETS: (await import("./config.js")).TARGETS }));
    const rows = [];
    for (const id of only.length ? only : Object.keys(TARGETS)) {
      for (const kind of ["video", "image"]) {
        const row = await frame.evaluate(async (id, kind, video) => {
          const { convert } = await import("./convert.js");
          const { DEFAULT_SETTINGS } = await import("./config.js");
          const blob = kind === "video"
            ? new Blob([Uint8Array.from(atob(video), (c) => c.charCodeAt(0))], { type: "video/mp4" })
            : await fetch("./assets/sample.jpg").then((r) => r.blob());
          const start = performance.now();
          const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timed out after 120 s")), 120000));
          try {
            const result = await Promise.race([convert({ blob, kind, time: 1 }, id, DEFAULT_SETTINGS), timeout]);
            const head = new TextDecoder("latin1").decode(await result.slice(0, 12).arrayBuffer()).replace(/[^\x20-\x7e]/g, ".");
            return { kind, id, kb: Math.round(result.size / 1024), ms: Math.round(performance.now() - start), head };
          } catch (e) {
            return { kind, id, error: String(e?.message || e) };
          }
        }, id, kind, video);
        console.log(JSON.stringify(row));
        rows.push(row);
      }
    }
    writeFileSync(`${out}results.json`, JSON.stringify(rows, null, 2));
  }

  const popup = await mount("popup.html", 360, 440);
  await popup.frame.waitForSelector(".mini-rules li");
  await popup.page.screenshot({ path: `${out}popup.png` });
} finally {
  await browser.close();
}
