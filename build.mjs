// Copies third-party engines into ext/vendor, writes the quality ring icons, and packs dist/ for AMO.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ext = new URL("./ext/", import.meta.url).pathname;
const mod = (p) => new URL(`./node_modules/${p}`, import.meta.url).pathname;

rmSync(`${ext}vendor`, { recursive: true, force: true });
const vendor = {
  "ffmpeg": [mod("@ffmpeg/ffmpeg/dist/esm"), [".js"]],
  "ffmpeg-core": [mod("@ffmpeg/core/dist/esm"), [".js", ".wasm"]],
  "avif": [mod("@jsquash/avif/codec/enc"), ["avif_enc.js", "avif_enc.wasm"]],
};
for (const [dir, [from, keep]] of Object.entries(vendor)) {
  mkdirSync(`${ext}vendor/${dir}`, { recursive: true });
  cpSync(from, `${ext}vendor/${dir}`, {
    recursive: true,
    filter: (src) => src === from || (keep.some((k) => src.endsWith(k)) && !src.includes("_mt")),
  });
}
cpSync(mod("@jsquash/avif/LICENSE"), `${ext}vendor/avif/LICENSE`);
const pkg = (name) => JSON.parse(readFileSync(mod(`${name}/package.json`), "utf8"));
writeFileSync(
  `${ext}vendor/NOTICE.txt`,
  ["@ffmpeg/ffmpeg", "@ffmpeg/core", "@jsquash/avif"]
    .map((name) => `${name} ${pkg(name).version} (${pkg(name).license}) ${pkg(name).homepage ?? ""}`.trim())
    .join("\n") + "\n",
);

// Ring colour runs red → amber → green as quality rises, matching the settings slider.
mkdirSync(`${ext}icons`, { recursive: true });
const hue = (step) => Math.round(step * 12);
for (let step = 0; step <= 10; step++) {
  const length = 2 * Math.PI * 6;
  writeFileSync(
    `${ext}icons/ring-${step}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="#8884" stroke-width="3"/>` +
      `<circle cx="8" cy="8" r="6" fill="none" stroke="hsl(${hue(step)} 85% 50%)" stroke-width="3" stroke-dasharray="${(length * step) / 10} ${length}" transform="rotate(-90 8 8)"/></svg>\n`,
  );
}
cpSync(new URL("./design/icon.svg", import.meta.url).pathname, `${ext}icons/icon.svg`);

if (process.argv.includes("--pack")) {
  const dist = new URL("./dist/", import.meta.url).pathname;
  execFileSync("npx", ["web-ext", "build", "--source-dir", ext, "--artifacts-dir", dist, "--overwrite-dest"], { stdio: "inherit" });
}
