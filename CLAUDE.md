# A·BASAR QR Studio — working notes for Claude

Brand-aware QR code generator. Portfolio project, public-facing code.

## Language rule

**Everything in this repository is written in English.** Code, comments, UI
strings, CLI output, commit messages, documentation, filenames. No Turkish
anywhere, including in strings the user only sees at runtime. Conversation with
the user may be in Turkish; the repository never is.

## Architecture

```
core.js      the whole engine: encode → lay out shapes → SVG / raster
index.html   browser UI, plain script tags, no build step
qrgen        Node CLI, same engine
png.js       standalone PNG encoder (zlib only, no native deps)
assets/      brand mark embedded as data URIs
vendor/      qrcode-generator (encoder) + jsQR (decoder), committed on purpose
```

`core.js` is a UMD-ish module: `window.ABQR` in the browser,
`require('./core.js')` in Node. Both front-ends must go through it — never
duplicate geometry logic in the UI or the CLI.

### Non-negotiable design invariants

- **Geometry is computed in module units** (1 unit = one QR module) and scaled
  to pixels only at serialisation. This is what keeps SVG and raster output
  identical. Do not introduce pixel maths inside `build()`.
- **Every visual element is a filled primitive painted in order.** One shape
  list feeds both the SVG writer and the software rasteriser. If you add a
  primitive type, implement it in `toSVG` *and* `rasterize`, or the self-test
  silently stops covering it.
- **The rasteriser is intentionally pessimistic** — it paints the logo as an
  opaque block so the readability test measures the worst case.
- **`rasterize` supersamples 2×.** Without it, some pixel-per-module ratios
  produce uneven module widths and the decoder drifts off the sampling grid,
  giving false failures. Do not remove it for speed.

## Readability constraints, established by measurement

These came out of `test/sweep.js`, not from taste. Changing them needs a new
sweep, not an argument:

- `DOT_SCALE.hex = 1.15`. Hexagons cover ~65% of their cell versus 100% for
  squares. Below ~1.12 codes start failing to decode.
- Hexagonal finder patterns break the 1:1:3:1:1 ratio scanners search for and
  almost never decode. The option stays available but must keep warning.
- Logo coverage above ~16% of modules gets a warning; 22% is the practical cap.
- Cobalt `#2563EB` on white is 4.6:1 contrast versus 17:1 for ink `#0C1B33` —
  fine large, marginal small.

## After changing geometry

```bash
node test/sweep.js        # exits 1 if any combination is unreadable
open test/preview.html    # visual check, also covers the PNG export path

./scripts/serve.sh        # dev server on 9060 (localhost + LAN), no-cache
```

The sweep takes a few minutes. Run it before claiming a rendering change is
safe — "it looks right" is exactly the failure mode this project exists to
prevent.

## Repository

- Remote: `github.com/aobasar/QRstudio` (private)
- No live demo: GitHub Pages needs a paid plan while the repo is private. If it
  is ever made public, enable Pages from `main` at root and point the homepage
  field at `https://aobasar.github.io/QRstudio/`
- Commits use the noreply address from the global git config
- `node_modules/` is ignored; `vendor/` is committed, because offline operation
  is a feature
- Keep the GitHub description, topics and homepage URL in sync with the README
