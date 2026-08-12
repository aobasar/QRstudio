/* ============================================================================
 * AB QR Studio — shared rendering engine
 *
 * Works both in the browser (window.ABQR) and in Node (require('./core.js')).
 * All geometry is computed in MODULE UNITS (1 unit = one QR module) and only
 * scaled to pixels at serialisation time, so SVG and raster output are always
 * identical.
 *
 * Every visual element is a filled primitive painted in order (painter's
 * algorithm). That is what lets the same shape list feed both the SVG writer
 * and the software rasteriser used by the readability self-test.
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vendor/qrcode.js'));
  } else {
    root.ABQR = factory(root.qrcode);
  }
})(typeof self !== 'undefined' ? self : this, function (qrcode) {
  'use strict';

  var SQRT3 = Math.sqrt(3);

  var DEFAULTS = {
    text: 'https://aobasar.com',
    ecc: 'H',              // L | M | Q | H  — H is required if you want a logo
    minVersion: 0,         // 0 = auto

    dot: 'hex',            // hex | circle | rounded | square
    dotScale: 0,           // 0 = per-style default
    finder: 'rounded',     // hex | circle | rounded | square

    frame: 'circle',       // none | circle | hex
    frameGap: 2.5,         // modules of clearance between QR corner and frame
    frameStroke: 0.9,      // modules; 0 = no outline
    frameFill: '',         // '' = use bg
    frameStrokeColor: '',  // '' = use fg

    fg: '#0C1B33',
    bg: '#FFFFFF',
    surround: '',          // area outside the frame. '' = auto: transparent when
                           // a frame is drawn (badge/sticker), bg otherwise

    logo: null,            // data: URI
    logoPct: 0.22,         // logo box width / QR side
    logoShape: 'hex',      // hex | circle | rounded | none
    logoPad: 0.6,          // modules of quiet space around the logo plate
    logoInset: 1,          // fraction of the image box the artwork actually fills

    quiet: 4,              // modules of quiet zone when frame === 'none'

    label: '',
    labelSize: 1.5,        // modules
    labelColor: '',        // '' = use fg
    labelFont: 'ui-sans-serif, -apple-system, Helvetica, Arial, sans-serif',
    labelTracking: 0.18,   // em

    px: 1024               // pixel size of the exported PNG / SVG width attr
  };

  /* Hexagons tile a square grid badly: at scale 1.0 a pointy-top hexagon covers
     only ~65% of its cell versus 100% for a square, and decoders start failing.
     1.15 restores enough ink to stay reliable — see test/sweep.js. */
  var DOT_SCALE = { hex: 1.15, circle: 1.02, rounded: 1.0, square: 1.0 };

  // ---------------------------------------------------------------- helpers

  function extend(base, over) {
    var out = {}, k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    for (k in over || {}) {
      if (Object.prototype.hasOwnProperty.call(over, k) && over[k] !== undefined) out[k] = over[k];
    }
    return out;
  }

  /* Pointy-top hexagon (vertex at top and bottom, vertical left/right sides),
     matching the A·BASAR mark. R = centre-to-vertex; width = R*sqrt(3). */
  function hexPts(cx, cy, R) {
    var pts = [], i, a;
    for (i = 0; i < 6; i++) {
      a = (90 + i * 60) * Math.PI / 180;
      pts.push([cx + R * Math.cos(a), cy - R * Math.sin(a)]);
    }
    return pts;
  }

  function circlePts(cx, cy, r, seg) {
    var pts = [], i, a;
    seg = seg || 40;
    for (i = 0; i < seg; i++) {
      a = i / seg * Math.PI * 2;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  function roundRectPts(x, y, w, h, r, seg) {
    var pts = [], i, a;
    seg = seg || 6;
    r = Math.min(r, w / 2, h / 2);
    var corners = [
      [x + w - r, y + r, -90, 0],
      [x + w - r, y + h - r, 0, 90],
      [x + r, y + h - r, 90, 180],
      [x + r, y + r, 180, 270]
    ];
    for (var c = 0; c < 4; c++) {
      var cc = corners[c];
      for (i = 0; i <= seg; i++) {
        a = (cc[2] + (cc[3] - cc[2]) * (i / seg)) * Math.PI / 180;
        pts.push([cc[0] + r * Math.cos(a), cc[1] + r * Math.sin(a)]);
      }
    }
    return pts;
  }

  /* One module / marker drawn in the requested style, centred on (cx, cy). */
  function stylePts(style, cx, cy, size) {
    switch (style) {
      case 'hex':     return hexPts(cx, cy, size / 2);
      case 'circle':  return circlePts(cx, cy, size / 2, 24);
      case 'rounded': return roundRectPts(cx - size / 2, cy - size / 2, size, size, size * 0.3, 4);
      default:        return roundRectPts(cx - size / 2, cy - size / 2, size, size, 0, 1);
    }
  }

  /* Containment test for the logo exclusion zone, in module units. */
  function inShape(shape, dx, dy, half) {
    switch (shape) {
      case 'circle':
        return Math.sqrt(dx * dx + dy * dy) <= half;
      case 'hex':
        // pointy-top hexagon of centre-to-vertex radius `half`
        return Math.abs(dx) <= half * SQRT3 / 2 &&
               Math.abs(dx) / SQRT3 + Math.abs(dy) <= half;
      default:
        return Math.abs(dx) <= half && Math.abs(dy) <= half;
    }
  }

  // ------------------------------------------------------------------ build

  /**
   * Encode `opts.text` and lay out every visual primitive.
   * Returns { shapes, box, moduleCount, opts, warnings, stats }.
   */
  function build(userOpts) {
    var o = extend(DEFAULTS, userOpts);
    var warnings = [];

    if (!o.text) throw new Error('Text to encode cannot be empty.');
    if (o.logo && o.ecc !== 'H') {
      warnings.push('Error correction should be H when a logo is used; readability is degraded.');
    }

    var qr = qrcode(o.minVersion, o.ecc);
    qr.addData(o.text, 'Byte');
    qr.make();

    var N = qr.getModuleCount();
    var S = N;                       // QR side, module units (no quiet zone yet)
    var stroke = Math.max(0, o.frameStroke);
    var gap = Math.max(0, o.frameGap);

    // ---- outer box + QR origin -------------------------------------------
    var box, ox, oy, cc, R = 0, labelR = 0;
    var hasLabel = !!(o.label && o.label.trim());
    var labelBand = hasLabel ? o.labelSize * 2.4 : 0;

    if (o.frame === 'circle') {
      R = (S / 2) * Math.SQRT2 + gap + stroke;
      if (hasLabel) { labelR = R + labelBand * 0.55; R += labelBand; }
      box = { w: 2 * R, h: 2 * R };
      cc = { x: R, y: R };
      ox = R - S / 2; oy = R - S / 2;
    } else if (o.frame === 'hex') {
      // pointy-top hexagon that contains the QR square with `gap` clearance
      var need1 = (S / 2) * (1 + 1 / SQRT3) + gap * 2 / SQRT3;
      var need2 = (S / 2 + gap) * 2 / SQRT3;
      R = Math.max(need1, need2) + stroke;
      box = { w: R * SQRT3, h: 2 * R + labelBand };
      cc = { x: box.w / 2, y: R };
      ox = cc.x - S / 2; oy = R - S / 2;
    } else {
      var q = Math.max(0, o.quiet);
      box = { w: S + 2 * q, h: S + 2 * q + labelBand };
      cc = { x: box.w / 2, y: (S + 2 * q) / 2 };
      ox = q; oy = q;
    }

    var shapes = [];
    var bg = o.bg;
    var fg = o.fg;
    var frameFill = o.frameFill || bg;
    var strokeCol = o.frameStrokeColor || fg;

    // ---- background + frame ----------------------------------------------
    // With a frame the code is a badge, so anything outside it stays
    // transparent by default — otherwise a dark palette prints as a big block.
    var surround = o.surround || (o.frame === 'none' ? bg : 'transparent');
    if (surround !== 'transparent') {
      shapes.push({ t: 'rect', x: 0, y: 0, w: box.w, h: box.h, fill: surround });
    }

    if (o.frame === 'circle') {
      if (stroke > 0) shapes.push({ t: 'circle', cx: cc.x, cy: cc.y, r: R, fill: strokeCol });
      shapes.push({ t: 'circle', cx: cc.x, cy: cc.y, r: R - stroke, fill: frameFill });
    } else if (o.frame === 'hex') {
      if (stroke > 0) shapes.push({ t: 'poly', pts: hexPts(cc.x, cc.y, R), fill: strokeCol });
      shapes.push({ t: 'poly', pts: hexPts(cc.x, cc.y, R - stroke * 2 / SQRT3), fill: frameFill });
    }

    // ---- logo exclusion zone ---------------------------------------------
    var logoBox = o.logoPct * S;                       // image box side
    var art = logoBox * (o.logoInset || 1);            // visible artwork width
    var plateHalf = 0;                                 // "radius" of the plate
    var hasLogo = !!o.logo && o.logoPct > 0;
    if (hasLogo && o.logoShape !== 'none') {
      plateHalf = (o.logoShape === 'hex')
        ? art / SQRT3 + o.logoPad          // hexagon: width = R*sqrt(3)
        : art / 2 + o.logoPad;
    } else if (hasLogo) {
      plateHalf = art / 2;
    }
    var excludeHalf = plateHalf + 0.5;     // keep modules off the plate edge
    var lcx = cc.x, lcy = (o.frame === 'circle') ? cc.y : oy + S / 2;

    function blocked(mcx, mcy) {
      if (!hasLogo) return false;
      return inShape(o.logoShape === 'none' ? 'rounded' : o.logoShape,
                     mcx - lcx, mcy - lcy, excludeHalf);
    }

    // ---- modules ----------------------------------------------------------
    var dotScale = o.dotScale > 0 ? o.dotScale : (DOT_SCALE[o.dot] || 1);
    var finderCorners = [[0, 0], [N - 7, 0], [0, N - 7]];

    function inFinder(r, c) {
      for (var i = 0; i < 3; i++) {
        var f = finderCorners[i];
        if (c >= f[0] && c < f[0] + 7 && r >= f[1] && r < f[1] + 7) return true;
      }
      return false;
    }

    var dark = 0, hidden = 0;
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        if (inFinder(r, c)) continue;
        var mcx = ox + c + 0.5, mcy = oy + r + 0.5;
        var isDark = qr.isDark(r, c);
        if (isDark) dark++;
        if (blocked(mcx, mcy)) { hidden++; continue; }
        if (!isDark) continue;
        shapes.push({ t: 'poly', pts: stylePts(o.dot, mcx, mcy, dotScale), fill: fg });
      }
    }

    // ---- finder patterns --------------------------------------------------
    var fStyle = o.finder;
    for (var k = 0; k < 3; k++) {
      var fx = ox + finderCorners[k][0] + 3.5;
      var fy = oy + finderCorners[k][1] + 3.5;
      var mul = (fStyle === 'hex') ? 2 / SQRT3 : 1;   // hexagons need widening
      shapes.push({ t: 'poly', pts: stylePts(fStyle, fx, fy, 7 * mul), fill: fg });
      shapes.push({ t: 'poly', pts: stylePts(fStyle, fx, fy, 5 * mul), fill: frameFill });
      shapes.push({ t: 'poly', pts: stylePts(fStyle, fx, fy, 3 * mul), fill: fg });
    }

    // ---- logo plate + artwork ---------------------------------------------
    if (hasLogo) {
      if (o.logoShape === 'hex') {
        shapes.push({ t: 'poly', pts: hexPts(lcx, lcy, plateHalf), fill: frameFill });
      } else if (o.logoShape === 'circle') {
        shapes.push({ t: 'circle', cx: lcx, cy: lcy, r: plateHalf, fill: frameFill });
      } else if (o.logoShape === 'rounded') {
        shapes.push({ t: 'poly', fill: frameFill,
          pts: roundRectPts(lcx - plateHalf, lcy - plateHalf, plateHalf * 2, plateHalf * 2, plateHalf * 0.28, 5) });
      }
      shapes.push({
        t: 'image', href: o.logo,
        x: lcx - logoBox / 2, y: lcy - logoBox / 2, w: logoBox, h: logoBox
      });
    }

    // ---- label -------------------------------------------------------------
    if (hasLabel) {
      if (o.frame === 'circle') {
        shapes.push({ t: 'arctext', cx: cc.x, cy: cc.y, r: labelR, text: o.label,
                      size: o.labelSize, fill: o.labelColor || fg });
      } else {
        shapes.push({ t: 'text', x: box.w / 2, y: box.h - o.labelSize * 0.9, text: o.label,
                      size: o.labelSize, fill: o.labelColor || fg });
      }
    }

    // ---- sanity checks -----------------------------------------------------
    var hiddenPct = dark ? hidden / (N * N) : 0;
    if (hiddenPct > 0.16) {
      warnings.push('Logo is too large: it covers ' + Math.round(hiddenPct * 100) +
                    '% of the modules. Keep it under 16%.');
    }
    if (o.frame !== 'none' && gap < 2) {
      warnings.push('Frame gap is ' + gap + ' modules — leave at least 2 for the quiet zone.');
    }
    if (o.frame === 'none' && o.quiet < 4) {
      warnings.push('Quiet zone is ' + o.quiet + ' modules — the standard requires at least 4.');
    }
    if (o.finder === 'hex') {
      warnings.push('Hexagonal finder patterns break the 1:1:3:1:1 ratio scanners look for — ' +
                    'this setting almost never decoded in testing. Keep the dots hexagonal and the ' +
                    'finders rounded to get the brand feel without losing readability.');
    }
    if (o.dot === 'hex' && dotScale < 1.05) {
      warnings.push('Hexagonal dots lay down less ink than squares; keep the dot scale at 1.05+ to stay readable.');
    }

    return {
      shapes: shapes, box: box, moduleCount: N, opts: o, warnings: warnings,
      stats: { version: (N - 17) / 4, dark: dark, hidden: hidden, hiddenPct: hiddenPct }
    };
  }

  // -------------------------------------------------------------------- SVG

  function n(v) { return Math.round(v * 1000) / 1000; }

  function toSVG(model, pxOverride) {
    var box = model.box, o = model.opts;
    var px = pxOverride || o.px;
    var unit = px / box.w;                 // px per module
    var W = px, H = n(box.h * unit);
    var s = [];
    var defs = [];

    s.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
           'width="' + n(W) + '" height="' + H + '" viewBox="0 0 ' + n(box.w * unit) + ' ' + H +
           '" shape-rendering="geometricPrecision">');

    model.shapes.forEach(function (sh, i) {
      var f;
      switch (sh.t) {
        case 'rect':
          s.push('<rect x="' + n(sh.x * unit) + '" y="' + n(sh.y * unit) + '" width="' + n(sh.w * unit) +
                 '" height="' + n(sh.h * unit) + '" fill="' + sh.fill + '"/>');
          break;
        case 'circle':
          s.push('<circle cx="' + n(sh.cx * unit) + '" cy="' + n(sh.cy * unit) + '" r="' + n(sh.r * unit) +
                 '" fill="' + sh.fill + '"/>');
          break;
        case 'poly':
          f = sh.pts.map(function (p) { return n(p[0] * unit) + ',' + n(p[1] * unit); }).join(' ');
          s.push('<polygon points="' + f + '" fill="' + sh.fill + '"/>');
          break;
        case 'image':
          s.push('<image x="' + n(sh.x * unit) + '" y="' + n(sh.y * unit) + '" width="' + n(sh.w * unit) +
                 '" height="' + n(sh.h * unit) + '" preserveAspectRatio="xMidYMid meet" xlink:href="' +
                 sh.href + '"/>');
          break;
        case 'text':
          s.push('<text x="' + n(sh.x * unit) + '" y="' + n(sh.y * unit) + '" fill="' + sh.fill +
                 '" font-family="' + o.labelFont + '" font-size="' + n(sh.size * unit) +
                 '" font-weight="600" letter-spacing="' + o.labelTracking + 'em" text-anchor="middle">' +
                 esc(sh.text) + '</text>');
          break;
        case 'arctext':
          var id = 'lbl' + i;
          var rr = sh.r * unit, ax = sh.cx * unit, ay = sh.cy * unit;
          var a0 = 165 * Math.PI / 180, a1 = 15 * Math.PI / 180;
          var p0 = [ax + rr * Math.cos(a0), ay + rr * Math.sin(a0)];
          var p1 = [ax + rr * Math.cos(a1), ay + rr * Math.sin(a1)];
          defs.push('<path id="' + id + '" fill="none" d="M ' + n(p0[0]) + ' ' + n(p0[1]) +
                    ' A ' + n(rr) + ' ' + n(rr) + ' 0 0 0 ' + n(p1[0]) + ' ' + n(p1[1]) + '"/>');
          s.push('<text fill="' + sh.fill + '" font-family="' + o.labelFont + '" font-size="' +
                 n(sh.size * unit) + '" font-weight="600" letter-spacing="' + o.labelTracking + 'em">' +
                 '<textPath xlink:href="#' + id + '" startOffset="50%" text-anchor="middle">' +
                 esc(sh.text) + '</textPath></text>');
          break;
      }
    });

    if (defs.length) s.splice(1, 0, '<defs>' + defs.join('') + '</defs>');
    s.push('</svg>');
    return s.join('\n');
  }

  function esc(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ------------------------------------------------------------- rasteriser

  function parseColor(c) {
    c = String(c).trim();
    if (c[0] === '#') {
      if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
      return [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)];
    }
    var m = c.match(/rgba?\(([^)]+)\)/);
    if (m) { var p = m[1].split(','); return [+p[0], +p[1], +p[2]]; }
    return [0, 0, 0];
  }

  function fillPoly(buf, W, H, pts, rgb) {
    var i, j, ymin = Infinity, ymax = -Infinity;
    for (i = 0; i < pts.length; i++) {
      if (pts[i][1] < ymin) ymin = pts[i][1];
      if (pts[i][1] > ymax) ymax = pts[i][1];
    }
    var y0 = Math.max(0, Math.floor(ymin)), y1 = Math.min(H - 1, Math.ceil(ymax));
    var xs = [];
    for (var y = y0; y <= y1; y++) {
      var sy = y + 0.5;
      xs.length = 0;
      for (i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        var a = pts[i], b = pts[j];
        if ((a[1] > sy) !== (b[1] > sy)) {
          xs.push(a[0] + (sy - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
      }
      if (!xs.length) continue;
      xs.sort(function (p, q) { return p - q; });
      for (i = 0; i + 1 < xs.length; i += 2) {
        var xa = Math.max(0, Math.round(xs[i])), xb = Math.min(W - 1, Math.round(xs[i + 1]) - 1);
        for (var x = xa; x <= xb; x++) {
          var idx = (y * W + x) * 4;
          buf[idx] = rgb[0]; buf[idx + 1] = rgb[1]; buf[idx + 2] = rgb[2]; buf[idx + 3] = 255;
        }
      }
    }
  }

  /**
   * Software rasteriser — used by the readability self-test and by the CLI's
   * PNG export. Text is not rendered (no font engine); logo artwork is filled
   * as a solid block, which is the worst case for a scanner.
   */
  function rasterize(model, px, ss) {
    var box = model.box;
    ss = ss || 2;                       // supersampling factor (anti-aliasing)
    var outW = Math.round(px), outH = Math.round(box.h * px / box.w);
    var unit = (outW * ss) / box.w;
    var W = outW * ss, H = outH * ss;
    var buf = new Uint8ClampedArray(W * H * 4);
    var i;
    for (i = 0; i < buf.length; i += 4) { buf[i] = buf[i + 1] = buf[i + 2] = 255; buf[i + 3] = 255; }

    model.shapes.forEach(function (sh) {
      var rgb;
      switch (sh.t) {
        case 'rect':
          rgb = parseColor(sh.fill);
          fillPoly(buf, W, H, [
            [sh.x * unit, sh.y * unit], [(sh.x + sh.w) * unit, sh.y * unit],
            [(sh.x + sh.w) * unit, (sh.y + sh.h) * unit], [sh.x * unit, (sh.y + sh.h) * unit]
          ], rgb);
          break;
        case 'circle':
          rgb = parseColor(sh.fill);
          fillPoly(buf, W, H, circlePts(sh.cx * unit, sh.cy * unit, sh.r * unit, 64), rgb);
          break;
        case 'poly':
          rgb = parseColor(sh.fill);
          fillPoly(buf, W, H, sh.pts.map(function (p) { return [p[0] * unit, p[1] * unit]; }), rgb);
          break;
        case 'image':
          rgb = parseColor(model.opts.fg);   // worst case: fully opaque artwork
          fillPoly(buf, W, H, [
            [sh.x * unit, sh.y * unit], [(sh.x + sh.w) * unit, sh.y * unit],
            [(sh.x + sh.w) * unit, (sh.y + sh.h) * unit], [sh.x * unit, (sh.y + sh.h) * unit]
          ], rgb);
          break;
      }
    });

    if (ss === 1) return { data: buf, width: W, height: H };

    // box-downsample back to the requested size
    var out = new Uint8ClampedArray(outW * outH * 4);
    var n2 = ss * ss;
    for (var y = 0; y < outH; y++) {
      for (var x = 0; x < outW; x++) {
        var r = 0, g = 0, b = 0;
        for (var sy = 0; sy < ss; sy++) {
          var rowBase = ((y * ss + sy) * W + x * ss) * 4;
          for (var sx = 0; sx < ss; sx++) {
            r += buf[rowBase + sx * 4];
            g += buf[rowBase + sx * 4 + 1];
            b += buf[rowBase + sx * 4 + 2];
          }
        }
        var oi = (y * outW + x) * 4;
        out[oi] = r / n2; out[oi + 1] = g / n2; out[oi + 2] = b / n2; out[oi + 3] = 255;
      }
    }
    return { data: out, width: outW, height: outH };
  }

  /**
   * Readability self-test: decode the rendered code at several sizes.
   * A design that only survives at one scale is fragile in print, so the
   * score matters more than a single pass/fail.
   */
  function selfTest(model, decoder, sizes) {
    sizes = sizes || [420, 620, 900, 1300, 1800];
    var pass = 0, decoded = null, results = [];
    sizes.forEach(function (px) {
      var r = rasterize(model, px, 2);
      var d = decoder(r.data, r.width, r.height);
      if (d) { pass++; decoded = d.data; }
      results.push({ px: px, ok: !!d });
    });
    return {
      pass: pass, total: sizes.length, results: results, decoded: decoded,
      match: decoded === model.opts.text
    };
  }

  return {
    DEFAULTS: DEFAULTS,
    DOT_SCALE: DOT_SCALE,
    build: build,
    toSVG: toSVG,
    rasterize: rasterize,
    selfTest: selfTest,
    hexPts: hexPts
  };
});
