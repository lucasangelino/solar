"use client";

import { useEffect, useRef, useState } from "react";
import { sampleDustyPaper, toJpeg } from "@/lib/dust";

type Props = { tableId: string; onCapture: (dataUrl: string) => void; onCancel: () => void };

/** Drone camera stand-in: the device camera, a file picker, or a synthetic sample. */
export function CameraCapture({ tableId, onCapture, onCancel }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"starting" | "live" | "unavailable">("starting");
  const [message, setMessage] = useState("");
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unavailable");
        setMessage(window.isSecureContext ? "This browser has no camera access." : "The camera needs HTTPS or localhost. Use “Upload photo” instead.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
        }
        setStatus("live");
      } catch (err) {
        setStatus("unavailable");
        setMessage(err instanceof DOMException && err.name === "NotAllowedError" ? "Camera permission was denied." : "No camera found.");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const snap = () => {
    if (!video.current || status !== "live") return;
    setFlash(true);
    const shot = toJpeg(video.current);
    setTimeout(() => onCapture(shot), 180);
  };

  const pick = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const img = new Image();
      img.src = String(reader.result);
      await img.decode();
      onCapture(toJpeg(img));
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Drone camera">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-sky-700">Drone SV-02 · gimbal camera</p>
            <h2 className="text-base font-semibold text-stone-900">Inspect table {tableId}</h2>
          </div>
          <button onClick={onCancel} className="rounded-md px-2 py-1 text-sm text-stone-500 hover:bg-stone-100" aria-label="Close camera">Esc</button>
        </div>

        <div className="relative aspect-video bg-stone-900">
          <video ref={video} playsInline muted className={`h-full w-full object-cover ${status === "live" ? "" : "hidden"}`} />
          {status === "live" && (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-[12%] rounded-lg border-2 border-dashed border-white/70" />
              <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white">Frame the sheet of paper inside the guide</p>
              <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-medium text-white"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />LIVE</span>
            </div>
          )}
          {status !== "live" && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-stone-300">
              <p className="text-sm">{status === "starting" ? "Starting camera…" : message}</p>
            </div>
          )}
          {flash && <div className="absolute inset-0 animate-[flash_.3s_ease-out] bg-white" />}
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 py-4">
          <button
            onClick={snap}
            disabled={status !== "live"}
            className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="h-3 w-3 rounded-full border-2 border-white" /> Take picture
          </button>
          <button onClick={() => file.current?.click()} className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50">
            Upload photo
          </button>
          <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <button onClick={() => onCapture(sampleDustyPaper(0.06 + Math.random() * 0.22))} className="rounded-lg px-3 py-2.5 text-sm text-stone-500 hover:bg-stone-100">
            Use sample image
          </button>
          <p className="ml-auto text-xs text-stone-400">Analysed on this device. Nothing is uploaded.</p>
        </div>
      </div>
    </div>
  );
}
