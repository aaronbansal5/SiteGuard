import { useEffect, useRef, useState } from "react";

export function CameraPreview({
  sessionId,
  failure,
}: {
  sessionId: string;
  failure?: string | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState(
    "Waiting for the Presage camera preview…",
  );
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    setVisible(false);
    const clear = () => {
      const c = canvas.current;
      if (c) c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    };
    if (failure) {
      clear();
      setMessage(failure);
      return;
    }
    const poll = async () => {
      let bitmap: ImageBitmap | undefined;
      try {
        const response = await fetch(`/api/sessions/${sessionId}/preview`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(3000),
          ]),
        });
        if (disposed) return;
        if (response.status === 204) {
          clear();
          setVisible(false);
          setMessage(
            "Presage is starting the camera. If this persists, restart the check-in below.",
          );
        } else if (
          response.ok &&
          response.headers.get("content-type")?.startsWith("image/jpeg")
        ) {
          bitmap = await createImageBitmap(await response.blob());
          if (disposed) return;
          const c = canvas.current;
          if (c) {
            c.width = bitmap.width;
            c.height = bitmap.height;
            c.getContext("2d")?.drawImage(bitmap, 0, 0);
            setVisible(true);
            setMessage("Live camera preview · mirrored for positioning");
          }
        } else {
          clear();
          setVisible(false);
          setMessage(
            "Camera preview unavailable. Check that the Presage bridge is running.",
          );
        }
      } catch {
        if (!disposed) {
          clear();
          setVisible(false);
          setMessage("Camera preview interrupted. Reconnecting…");
        }
      } finally {
        bitmap?.close();
        if (!disposed) timer = setTimeout(() => void poll(), 250);
      }
    };
    void poll();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      clear();
    };
  }, [sessionId, failure]);
  return (
    <div className="live-camera-preview">
      <div className="live-camera-image">
        <canvas
          ref={canvas}
          aria-label="Live mirrored preview from the Presage camera"
          style={{ visibility: visible ? "visible" : "hidden" }}
        />
        {visible && <div className="face-position-guide" aria-hidden="true" />}
        {!visible && <p>{message}</p>}
      </div>
      <p className="fine-print" role="status">
        {message}
      </p>
      <p className="fine-print">
        Center your face inside the guide, sit still, and use even lighting. The
        guide helps positioning; it does not confirm measurement quality.
        Preview frames are not recorded.
      </p>
    </div>
  );
}
