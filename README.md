# SolarScan: drone soiling demo

A dashboard for a drone-based solar panel inspection service. It shows an isometric solar farm (16 fixed-tilt tables, 256 modules, an inverter skid, a weather mast, a fence and trees) and a sidebar with plant stats. All data is mocked except the **live demo**: the "Simulate drone flight" button opens the camera, you photograph a sheet of paper with dust on it, the drone flies to the selected table, and the measured dust coverage updates that table.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000. No API keys or paid services are used. The camera works on `localhost` or over HTTPS. To use a phone on the LAN, serve over HTTPS (for example `next dev --experimental-https`) or use "Upload photo", which opens the phone camera.

## How dust is detected

Everything runs in the browser (`src/lib/dust.ts`), free and offline. Nothing is uploaded.

1. Find the sheet of paper: Otsu threshold on a blurred copy, largest bright region, holes filled.
2. Estimate the clean-paper brightness per area: 90th percentile in a 12×12 grid, interpolated, so lighting gradients and shadows don't count as dust.
3. Mark pixels more than 16% darker than the clean paper around them as dust. Coverage % = dust pixels / sheet pixels.
4. Count the specks, the largest patch and how much dust sits on the lower edge, to describe the pattern.

The result shows the photo with the detected dust highlighted in orange.

### Plugging in a model

Detection goes through `src/lib/detectors/`. `activeDetector()` uses the third-party model when one is configured, otherwise the on-device calculation above. To add a model, set `MODEL` and implement `detect` in `src/lib/detectors/model.ts` (it must return a `DustResult`). If the model throws, the dashboard falls back to the on-device calculation and says so in the result.

"Use sample image" in the camera dialog generates a synthetic dusty sheet, so you can rehearse without a camera.

## The farm figure

`scripts/build-farm.mjs` draws the farm with the [anatomy](https://skills.sh/wheresryan22/anatomy) isometric kit (`scripts/iso/`) and writes `src/generated/farm.ts`. After changing the layout, run:

```bash
npm run farm
```

`npm run farm:preview -- out.html --dust` writes a standalone preview page.

Mock data is in `src/lib/mock.ts`.

## Credits

The isometric kit in `scripts/iso/` and `src/styles/iso.css` comes from [wheresryan22/anatomy](https://github.com/wheresryan22/anatomy) (MIT, see `scripts/iso/LICENSE`).
