// End-to-end: serves a page with an image and a video, triggers each Save as item the way the menu does,
// and checks the files land in the download folder. Test-only glue is appended to a copy of background.js.
import puppeteer from "puppeteer-core";
import { createServer } from "node:http";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const harness = `${root}.smoke/e2e-ext/`;
const downloads = `${root}.smoke/downloads/`;
rmSync(harness, { recursive: true, force: true });
rmSync(downloads, { recursive: true, force: true });
mkdirSync(downloads, { recursive: true });
cpSync(`${root}ext`, harness, { recursive: true });
const manifest = JSON.parse(readFileSync(`${harness}manifest.json`, "utf8"));
manifest.content_scripts = [{ matches: ["http://127.0.0.1/*"], js: ["e2e-bridge.js"] }];
writeFileSync(`${harness}manifest.json`, JSON.stringify(manifest));
// Menus can't be opened over WebDriver, so the page posts a request and the background runs the real
// handler with the info Firefox would pass. No target element id exists, so video position reads as 0.
writeFileSync(`${harness}e2e-bridge.js`, `
window.addEventListener("message", (e) => e.data?.recastTest && browser.runtime.sendMessage(e.data));`);
appendFileSync(`${harness}background.js`, `
notify = (title, message) => console.log("NOTIFY", title, message);
browser.runtime.onMessage.addListener(async (m, sender) => {
  if (!m.recastTest) return;
  const [id] = await browser.tabs.executeScript(sender.tab.id, { code: \`(() => {
    const el = document.querySelector(${"${JSON.stringify(m.selector)}"});
    return el.currentSrc || el.src;
  })()\` });
  await saveAs({ menuItemId: m.target, mediaType: m.mediaType, srcUrl: id, pageUrl: sender.tab.url, frameId: 0, targetElementId: 0 }, sender.tab);
  return "done";
});`);

const files = {
  "/": ["text/html", `<!doctype html><img id="img" src="/sample.jpg" width="300"><video id="vid" src="/clip.mp4" muted width="300"></video>`],
  "/sample.jpg": ["image/jpeg", readFileSync(`${root}ext/assets/sample.jpg`)],
  "/clip.mp4": ["video/mp4", readFileSync(`${root}design/test.mp4`)],
};
const server = createServer((req, res) => {
  const [type, body] = files[req.url] ?? ["text/plain", "not found"];
  res.writeHead(files[req.url] ? 200 : 404, { "content-type": type });
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await puppeteer.launch({
  dumpio: true,
  browser: "firefox",
  executablePath: `${root}.browser/firefox/firefox`,
  headless: true,
  protocolTimeout: 300_000,
  extraPrefsFirefox: {
    "xpinstall.signatures.required": false,
    "devtools.console.stdout.chrome": true,
    "devtools.console.stdout.content": true,
    "browser.download.folderList": 2,
    "browser.download.dir": downloads,
    "browser.download.useDownloadDir": true,
    "browser.download.always_ask_before_handling_new_types": false,
  },
});
try {
  await browser.installExtension(harness);
  await new Promise((r) => setTimeout(r, 1500));
  const page = await browser.newPage();
  page.on("console", (m) => console.log("[page]", m.text()));
  await page.goto(`http://127.0.0.1:${port}/`);
  const cases = [
    ["#img", "image", "webp"], ["#img", "image", "avif"],
    ["#vid", "video", "webp-anim"], ["#vid", "video", "mp4"], ["#vid", "video", "gif"],
  ];
  for (const [selector, mediaType, target] of cases) {
    await page.evaluate((m) => window.postMessage(m, "*"), { recastTest: true, selector, mediaType, target });
  }
  const want = 5;
  const deadline = Date.now() + 120_000;
  const listed = () => (existsSync(downloads) ? readdirSync(downloads).filter((f) => !f.endsWith(".part")) : []);
  while (listed().length < want && Date.now() < deadline) await new Promise((r) => setTimeout(r, 1000));
  await new Promise((r) => setTimeout(r, 1000));
  if (listed().length < want) throw new Error(`Expected ${want} downloads, found ${listed().length}`);
  for (const f of listed()) console.log(f, statSync(`${downloads}${f}`).size);
} finally {
  await browser.close();
  server.close();
}
