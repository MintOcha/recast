// Injected into the page on demand. Reads the right-clicked media when the extension cannot fetch it directly.
window.recastCapture ??= (() => {
  const RECORDABLE = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

  async function record(video, seconds) {
    const stream = video.mozCaptureStream ? video.mozCaptureStream() : video.captureStream();
    const recorder = new MediaRecorder(stream, { mimeType: RECORDABLE.find((t) => MediaRecorder.isTypeSupported(t)) });
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    const wasPaused = video.paused;
    const remaining = Number.isFinite(video.duration) ? video.duration - video.currentTime : seconds;
    recorder.start();
    if (wasPaused) await video.play();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, Math.max(0.5, Math.min(seconds, remaining)) * 1000);
      video.addEventListener("ended", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    recorder.stop();
    await stopped;
    if (wasPaused) video.pause();
    return new Blob(chunks, { type: "video/webm" });
  }

  const pack = async (blob, extra) => ({ bytes: await blob.arrayBuffer(), type: blob.type, ...extra });

  return async ({ targetElementId, recordSeconds }) => {
    const el = browser.menus.getTargetElement(targetElementId);
    if (!el) return null;
    const video = el instanceof HTMLVideoElement ? el : null;
    const time = video?.currentTime ?? 0;
    const url = el.currentSrc || el.src;
    if (url) {
      const response = await fetch(url, { credentials: "include" }).catch(() => null);
      if (response?.ok) return pack(await response.blob(), { time, recorded: false });
    }
    if (!video) return null;
    // Streams (MediaSource) have no file to fetch, so record what plays instead.
    return pack(await record(video, recordSeconds), { time: 0, recorded: true });
  };
})();

// Returns the playback position so a fetched video converts from where the user paused.
window.recastPosition = (targetElementId) => browser.menus.getTargetElement(targetElementId)?.currentTime ?? 0;

// executeScript returns the last expression; keep it clonable.
undefined;
