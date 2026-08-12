#!/usr/bin/env node
/* Readability sweep — decodes every style combination at several raster sizes.
 *
 *   node test/sweep.js
 *
 * This is what set DOT_SCALE.hex to 1.15: hexagons cover only ~65% of their
 * cell at scale 1.0 and decoders start dropping the code. It is also what
 * disqualified hexagonal finder patterns. Re-run after touching any geometry
 * in core.js. Exits non-zero if any combination is completely unreadable.
 */
'use strict';
var ABQR = require('../core.js');
var jsQR = require('../vendor/jsQR.js');

var PAYLOADS = [
  ['short url', 'https://aobasar.com'],
  ['long url',  'https://aobasar.com/work/case-study-2026-brand-refresh'],
  ['phone',     'tel:+905551234567'],
  ['wifi',      'WIFI:T:WPA;S:AOBASAR-Office;P:supersecret2026;;'],
  ['vcard',     'BEGIN:VCARD\nVERSION:3.0\nN:Basar;Ahmet\nEMAIL:ahmet@aobasar.com\nEND:VCARD']
];
var FRAMES = ['none', 'circle', 'hex'];
var DOTS = ['hex', 'circle', 'rounded', 'square'];
var FINDERS = ['rounded', 'circle', 'square', 'hex'];

var total = 0, perfect = 0, fragile = 0, broken = 0;
var problems = [];

PAYLOADS.forEach(function (p) {
  process.stdout.write('\n' + p[0] + '  (' + p[1].length + ' bytes)\n');
  FRAMES.forEach(function (frame) {
    var line = '  ' + frame.padEnd(7);
    DOTS.forEach(function (dot) {
      FINDERS.forEach(function (finder) {
        var model = ABQR.build({
          text: p[1], frame: frame, dot: dot, finder: finder,
          logo: 'data:,x', logoPct: 0.22, logoShape: 'hex'
        });
        var t = ABQR.selfTest(model, jsQR);
        total++;
        if (t.pass === t.total && t.match) perfect++;
        else if (t.pass > 0) { fragile++; problems.push([p[0], frame, dot, finder, t.pass + '/' + t.total]); }
        else { broken++; problems.push([p[0], frame, dot, finder, 'NO DECODE']); }
        if (finder === 'rounded') line += ' ' + dot.slice(0, 3) + ':' + t.pass;
      });
    });
    process.stdout.write(line + '\n');
  });
});

process.stdout.write('\n' + total + ' combinations: ' + perfect + ' solid, ' +
                     fragile + ' fragile, ' + broken + ' unreadable\n');
if (problems.length) {
  process.stdout.write('\nproblems:\n');
  problems.forEach(function (r) {
    process.stdout.write('  ' + r[0].padEnd(10) + r[1].padEnd(8) + r[2].padEnd(9) +
                         'finder:' + r[3].padEnd(9) + r[4] + '\n');
  });
}
/* Fail the run only if something is entirely unreadable — "fragile" combos are
   decoder-strictness artefacts, not necessarily unusable in the real world. */
process.exit(broken ? 1 : 0);
