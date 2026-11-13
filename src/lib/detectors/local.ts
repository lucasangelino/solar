import { measureDust } from "@/lib/dust";
import type { DustDetector } from "./types";

/** The free on-device pixel measurement (src/lib/dust.ts). Always available. */
export const localDetector: DustDetector = {
  id: "local-pixels",
  name: "On-device pixel analysis",
  kind: "local",
  async detect(image) {
    const m = measureDust(image);
    const warnings: string[] = [];
    if (m.paperPercent < 15) warnings.push(`The sheet fills only ${m.paperPercent.toFixed(0)}% of the photo; move closer for a more reliable reading.`);
    return {
      coveragePercent: m.coveragePercent,
      overlay: m.overlay,
      pattern: m.pattern,
      details: [
        { label: "Specks", value: String(m.specks) },
        { label: "Largest patch", value: `${m.largestPatchPercent.toFixed(1)}%` },
        { label: "Lower edge", value: `${(m.lowerEdgeShare * 100).toFixed(0)}%` },
      ],
      warnings,
    };
  },
};
