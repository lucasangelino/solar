// A dust detector turns one photo into a soiling result. The dashboard only talks to this interface,
// so the on-device calculation and a third-party model are interchangeable.

export type DustDetail = { label: string; value: string };

export interface DustResult {
  /** Share of the surface covered by dust, 0–100. */
  coveragePercent: number;
  /** The photo with the detected dust drawn on it (data URL), if the detector can produce one. */
  overlay?: string;
  /** One-sentence description of how the dust is distributed. */
  pattern?: string;
  /** Extra figures to show in the result (specks, confidence, …). */
  details: DustDetail[];
  /** Problems with the photo the presenter should know about. */
  warnings: string[];
}

export interface DustDetector {
  id: string;
  /** Shown to the audience, e.g. "On-device pixel analysis". */
  name: string;
  kind: "local" | "model";
  /** Load weights, warm up… Called once before the first detect. */
  prepare?: () => Promise<void>;
  detect: (image: HTMLImageElement) => Promise<DustResult>;
}

export interface DetectionOutcome extends DustResult {
  detector: { id: string; name: string; kind: DustDetector["kind"] };
  /** Set when the model failed and the local calculation was used instead. */
  fallbackReason?: string;
}
