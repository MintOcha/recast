import { FFmpeg } from "./vendor/ffmpeg/index.js";
import avifFactory from "./vendor/avif/avif_enc.js";
import { TARGETS } from "./config.js";

// ---- Decoding -------------------------------------------------------------

const loaded = (el, event) =>
  new Promise((resolve, reject) => {
    el.addEventListener(event, resolve, { once: true });
    el.addEventListener("error", () => reject(new Error("This file could not be opened.")), { once: true });
  });

/** Draws an image blob, or the video frame at `time`, onto a canvas. */
async function rasterize({ blob, kind, time = 0 }) {
  const url = URL.createObjectURL(blob);
  try {
    let source, width, height;
    if (kind === "video") {
      source = document.createElement("video");
      source.muted = true;
      source.preload = "auto";
      source.src = url;
      await loaded(source, "loadeddata");
      source.currentTime = Math.min(time, Math.max(0, source.duration - 0.05));
      await loaded(source, "seeked");
      [width, height] = [source.videoWidth, source.videoHeight];
    } else {
      source = new Image();
      source.src = url;
      await source.decode().catch(() => {
        throw new Error("This image could not be opened.");
      });
      [width, height] = [source.naturalWidth, source.naturalHeight];
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(source, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const canvasBlob = (canvas, mime, quality) =>
  new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed."))), mime, quality),
  );

// ---- Engines ----------------------------------------------------------------

async function encodeCanvas(input, target, quality) {
  const canvas = await rasterize(input);
  if (target.mime === "image/jpeg") {
    // JPEG has no alpha; flatten onto white instead of the default black.
    const flat = document.createElement("canvas");
    [flat.width, flat.height] = [canvas.width, canvas.height];
    const ctx = flat.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    return canvasBlob(flat, target.mime, quality / 100);
  }
  return canvasBlob(canvas, target.mime, target.quality ? quality / 100 : undefined);
}

let avifModule;
async function encodeAvif(input, target, quality) {
  avifModule ??= avifFactory({ noInitialRun: true });
  const canvas = await rasterize(input);
  const { data, width, height } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  const out = (await avifModule).encode(new Uint8Array(data.buffer), width, height, {
    quality,
    qualityAlpha: -1,
    denoiseLevel: 0,
    tileColsLog2: 0,
    tileRowsLog2: 0,
    speed: 6,
    subsample: 1,
    chromaDeltaQ: false,
    sharpness: 0,
    tune: 0,
    enableSharpYUV: false,
    bitDepth: 8,
  });
  if (!out) throw new Error("Encoding failed.");
  return new Blob([out], { type: target.mime });
}

let engine;
async function ffmpeg() {
  if (!engine) {
    const instance = new FFmpeg();
    engine = instance
      .load({
        coreURL: new URL("./vendor/ffmpeg-core/ffmpeg-core.js", import.meta.url).href,
        wasmURL: new URL("./vendor/ffmpeg-core/ffmpeg-core.wasm", import.meta.url).href,
      })
      .then(() => instance);
    engine.catch(() => (engine = undefined));
  }
  return engine;
}

/** Frees the video engine's memory; the next conversion loads it again. */
export async function releaseEngine() {
  const pending = engine;
  engine = undefined;
  (await pending?.catch(() => null))?.terminate();
}

const scaleFilter = (maxWidth) => `scale='min(${maxWidth},iw)':-2:flags=lanczos`;
const lerp = (from, to, quality) => Math.round(from + ((to - from) * quality) / 100);

function targetArgs(target, quality, { fps, maxWidth }) {
  const frames = `fps=${fps},${scaleFilter(maxWidth)}`;
  switch (target.id) {
    case "webp-anim":
      return ["-vf", frames, "-an", "-c:v", "libwebp_anim", "-lossless", "0", "-quality", `${quality}`,
        "-compression_level", "4", "-loop", "0"];
    case "gif": {
      const dither = quality >= 50 ? "sierra2_4a" : "bayer:bayer_scale=3";
      return ["-an", "-filter_complex",
        `[0:v]${frames},split[a][b];[a]palettegen=max_colors=${lerp(8, 256, quality)}:stats_mode=diff[p];[b][p]paletteuse=dither=${dither}`,
        "-loop", "0"];
    }
    case "mp4":
      return ["-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast",
        "-crf", `${lerp(40, 18, quality)}`, "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:a", "libopus", "-b:a", "128k", "-movflags", "+faststart"];
    default:
      throw new Error(`No video recipe for ${target.label}.`);
  }
}

async function encodeFfmpeg(input, target, quality, animation, onProgress) {
  const ff = await ffmpeg();
  // ffmpeg's own decoders lack AVIF, SVG and animated WebP, so still images go in as PNG.
  const still = input.kind === "image" && input.blob.type !== "image/gif";
  const data = still ? await encodeCanvas(input, TARGETS.png, 100) : input.blob;
  const inputArgs = still
    ? ["-loop", "1", "-framerate", `${animation.fps}`, "-t", `${animation.seconds}`, "-i", "input"]
    : target.animated
      ? ["-ss", `${input.time ?? 0}`, "-t", `${animation.seconds}`, "-i", "input"]
      : ["-i", "input"];
  const output = `output.${target.ext}`;
  const report = ({ progress }) => onProgress?.(Math.min(1, Math.max(0, progress)));
  ff.on("progress", report);
  let lastLog = "";
  const log = ({ message }) => /error|invalid|fail/i.test(message) && (lastLog = message);
  ff.on("log", log);
  try {
    await ff.writeFile("input", new Uint8Array(await data.arrayBuffer()));
    const code = await ff.exec([...inputArgs, ...targetArgs(target, quality, animation), output]);
    if (code !== 0) throw new Error(`Converting to ${target.label} failed. ${lastLog}`.trim());
    return new Blob([await ff.readFile(output)], { type: target.mime });
  } catch (error) {
    // A wasm trap leaves the engine unusable; drop it so the next conversion starts clean.
    await releaseEngine();
    throw error instanceof Error ? error : new Error(`Converting to ${target.label} failed.`);
  } finally {
    ff.off("progress", report);
    ff.off("log", log);
    if (engine) await Promise.allSettled([ff.deleteFile("input"), ff.deleteFile(output)]);
  }
}

const ENGINES = { canvas: encodeCanvas, avif: encodeAvif, ffmpeg: encodeFfmpeg };

/**
 * Converts one media item.
 * @param input {{blob: Blob, kind: "image"|"video", time?: number}} time = playback position for videos.
 */
export function convert(input, targetId, { quality, animation }, onProgress) {
  const target = TARGETS[targetId];
  return ENGINES[target.engine](input, target, quality[targetId], animation, onProgress);
}
