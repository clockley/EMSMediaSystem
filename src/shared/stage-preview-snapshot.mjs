/** Silent stage confidence stream. One fetch/decode at a time, at most 10fps. */
export function createStagePreviewSnapshot({
  document,
  sessionId,
  getFrame,
  schedule = setTimeout,
  cancel = clearTimeout,
  decode = (blob) => globalThis.createImageBitmap(blob),
  onStream = () => {},
  onError = () => {},
  isCurrent = () => true,
}) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Stage preview requires a 2D canvas");
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);

  let stream = null;
  let timer = null;
  let disposed = false;
  const active = () => !disposed && isCurrent();

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (timer !== null) cancel(timer);
    timer = null;
    stream?.getTracks().forEach((track) => track.stop());
  }

  function report(error) {
    if (!active()) return;
    // Error reporting must not prevent bitmap/track cleanup or future retries.
    try { onError(error); } catch {}
  }

  async function refresh() {
    timer = null;
    let bitmap = null;
    try {
      if (!active()) return;
      const data = await getFrame();
      if (!active() || !data || data.sessionId !== sessionId) return;
      const { width, height } = data;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return;
      // Electron normally clones Uint8Array directly; also accept serialized Buffer/array bytes.
      const bytes = data.bytes?.type === "Buffer" ? new Uint8Array(data.bytes.data)
        : Array.isArray(data.bytes) ? new Uint8Array(data.bytes) : data.bytes;
      if ((!ArrayBuffer.isView(bytes) && !(bytes instanceof ArrayBuffer)) || !bytes.byteLength) return;
      bitmap = await decode(new Blob([bytes], { type: "image/jpeg" }));
      if (!active()) return;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      context.drawImage(bitmap, 0, 0, width, height);
    } catch (error) {
      report(error);
    } finally {
      try { bitmap?.close(); } catch (error) { report(error); }
      if (active()) timer = schedule(refresh, 100);
      else dispose();
    }
  }

  try {
    stream = canvas.captureStream(10);
    if (active()) {
      onStream(stream);
      if (active()) timer = schedule(refresh, 0);
      else dispose();
    } else dispose();
  } catch (error) {
    dispose();
    throw error;
  }
  return { stream, dispose };
}