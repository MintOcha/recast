// Single source of truth for what Recast can read, what it can write, and the defaults.

export const SOURCE_GROUPS = [
  {
    kind: "image",
    label: "Image",
    allLabel: "All images",
    formats: [
      { id: "png", label: "PNG", mimes: ["image/png", "image/apng"], exts: ["png", "apng"] },
      { id: "jpeg", label: "JPEG", mimes: ["image/jpeg", "image/pjpeg"], exts: ["jpg", "jpeg", "jfif", "pjpeg"] },
      { id: "webp", label: "WebP", mimes: ["image/webp"], exts: ["webp"] },
      { id: "avif", label: "AVIF", mimes: ["image/avif"], exts: ["avif"] },
      { id: "gif", label: "GIF", mimes: ["image/gif"], exts: ["gif"] },
      { id: "svg", label: "SVG", mimes: ["image/svg+xml"], exts: ["svg"] },
      { id: "bmp", label: "BMP", mimes: ["image/bmp"], exts: ["bmp"] },
    ],
  },
  {
    kind: "video",
    label: "Video",
    allLabel: "All videos",
    formats: [
      { id: "mp4", label: "MP4", mimes: ["video/mp4"], exts: ["mp4", "m4v"] },
      { id: "webm", label: "WebM", mimes: ["video/webm"], exts: ["webm"] },
      { id: "mov", label: "MOV", mimes: ["video/quicktime"], exts: ["mov"] },
      { id: "ogg", label: "Ogg", mimes: ["video/ogg"], exts: ["ogv", "ogg"] },
    ],
  },
];

/** A source id is `<kind>:*` (every format of that kind) or `<kind>:<format>`. */
export const anySource = (kind) => `${kind}:*`;

export function sourceLabel(id) {
  const [kind, format] = id.split(":");
  const group = SOURCE_GROUPS.find((g) => g.kind === kind);
  if (!group) return id;
  if (format === "*") return group.allLabel;
  return group.formats.find((f) => f.id === format)?.label ?? format;
}

export function sourceFormatOf(kind, { mime, url }) {
  const group = SOURCE_GROUPS.find((g) => g.kind === kind);
  if (!group) return null;
  const cleanMime = mime?.split(";")[0].trim().toLowerCase();
  if (cleanMime) {
    const byMime = group.formats.find((f) => f.mimes.includes(cleanMime));
    if (byMime) return byMime.id;
  }
  const ext = url?.match(/\.([a-z0-9]{2,5})(?:$|[?#])/i)?.[1]?.toLowerCase();
  return group.formats.find((f) => f.exts.includes(ext))?.id ?? null;
}

/**
 * Output formats. `engine` picks the encoder; `quality` false means the format is lossless only.
 * `animated` formats render a clip (from the playback position for videos).
 */
export const TARGET_GROUPS = [
  {
    label: "Image",
    formats: [
      { id: "webp", label: "WebP", ext: "webp", mime: "image/webp", engine: "canvas", quality: true },
      { id: "avif", label: "AVIF", ext: "avif", mime: "image/avif", engine: "avif", quality: true },
      { id: "jpeg", label: "JPEG", ext: "jpg", mime: "image/jpeg", engine: "canvas", quality: true },
      { id: "png", label: "PNG", ext: "png", mime: "image/png", engine: "canvas", quality: false },
    ],
  },
  {
    label: "Animated",
    formats: [
      { id: "webp-anim", label: "Animated WebP", ext: "webp", mime: "image/webp", engine: "ffmpeg", quality: true, animated: true },
      { id: "gif", label: "GIF", ext: "gif", mime: "image/gif", engine: "ffmpeg", quality: true, animated: true },
    ],
  },
  {
    label: "Video",
    formats: [
      { id: "mp4", label: "MP4 (H.264)", ext: "mp4", mime: "video/mp4", engine: "ffmpeg", quality: true, video: true },
    ],
  },
];

export const TARGETS = Object.fromEntries(TARGET_GROUPS.flatMap((g) => g.formats).map((f) => [f.id, f]));

export const DEFAULT_SETTINGS = {
  folder: "",
  rules: [
    { from: [anySource("video")], to: "webp-anim" },
    { from: [anySource("video")], to: "mp4" },
    { from: [anySource("video")], to: "gif" },
    { from: [anySource("image")], to: "webp" },
    { from: [anySource("image")], to: "avif" },
    { from: [anySource("image")], to: "png" },
  ],
  quality: Object.fromEntries(Object.keys(TARGETS).map((id) => [id, 70])),
  animation: { seconds: 10, fps: 15, maxWidth: 480 },
};

export const LIMITS = {
  quality: { min: 1, max: 100 },
  seconds: { min: 1, max: 60 },
  fps: { min: 1, max: 30 },
  maxWidth: { min: 64, max: 1920 },
  // Videos without a downloadable file (streams) are recorded while they play; this caps that wait.
  recordSeconds: 120,
};

/** The 0..10 ring icon that matches a quality, shared by the menu, popup and settings. */
export const ringStep = (quality) => Math.round(quality / 10);
export const ringIcon = (target, quality) => `icons/ring-${target.quality ? ringStep(quality) : 10}.svg`;
