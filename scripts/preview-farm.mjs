// Writes a standalone preview page of the farm (for visual checks).
import { readFileSync, writeFileSync } from "node:fs";
const ts = readFileSync("src/generated/farm.ts", "utf8");
const svg = JSON.parse(ts.match(/export const FARM_SVG = (".*");/s)[1]);
const css = readFileSync("src/styles/iso.css", "utf8") + readFileSync("src/styles/farm.css", "utf8");
const out = process.argv[2] || "preview.html";
const dust = process.argv.includes("--dust");
writeFileSync(out, `<!doctype html><meta charset="utf-8"><style>${css} body{margin:0;background:#eef1ea} .wrap{padding:10px}</style><div class="iso farm" data-theme="light" ${process.argv.includes("--fly") ? "data-flying data-beam" : ""}><div class="wrap">${svg}</div></div><script>${dust ? `document.querySelectorAll('.pv-table').forEach((t,i)=>t.querySelector('.pv-dust').style.setProperty('--dust',[0.1,0.5,0.9,0.3][i%4]))` : ""}</script>`);
console.log("wrote", out);
