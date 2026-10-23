// Renders media/icon.png (128x128) with no image dependencies: antialiased shapes via signed distance fields.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const S = 128;
const px = Buffer.alloc(S * S * 4);
const bg = [217, 119, 87];
const fg = [255, 255, 255];

const roundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const circle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;
const segment = (x, y, ax, ay, bx, by, w) => {
  const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - w;
};
const cov = (d) => Math.max(0, Math.min(1, 0.5 - d));

function shape(x, y) {
  const w = 5;
  const head = circle(x, y, 42, 44, 15);
  const body = Math.max(circle(x, y, 42, 98, 30), y - 98);
  const arrows = Math.min(
    segment(x, y, 76, 40, 106, 40, w), segment(x, y, 106, 40, 95, 29, w), segment(x, y, 106, 40, 95, 51, w),
    segment(x, y, 106, 76, 76, 76, w), segment(x, y, 76, 76, 87, 65, w), segment(x, y, 76, 76, 87, 87, w)
  );
  return Math.min(head, body, arrows);
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const sx = x + 0.5, sy = y + 0.5;
    const a = cov(roundRect(sx, sy, 64, 64, 64, 64, 26));
    const f = cov(shape(sx, sy)) * a;
    const i = (y * S + x) * 4;
    for (let c = 0; c < 3; c++) px[i + c] = Math.round(bg[c] * (1 - f / (a || 1)) + fg[c] * (f / (a || 1)));
    px[i + 3] = Math.round(a * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(path.join(__dirname, '..', 'media', 'icon.png'), png);
