// 应用图标生成器 v2：纯 Node 实现，无外部依赖
// 设计：靛蓝渐变圆角方块 + 白色圆头对勾（胶囊笔触）+ 对勾投影 + 顶部高光 + 琥珀色提醒徽标
// 渲染：1024 逻辑分辨率 × 4x 超采样抗锯齿，box 降采样到目标尺寸
import zlib from "zlib";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../src-tauri/icons");

/* ---------------- 几何工具 ---------------- */
/** 点到线段（胶囊）的有符号距离，r 为笔触半径 */
function capsuleDist(px, py, x1, y1, x2, y2, r) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy) - r;
}
/** 圆角矩形 SDF（<=0 在内部） */
function roundRectSDF(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
/** SDF → 抗锯齿 alpha（像素尺度的平滑步进） */
const aa = (sdf, px) => clamp01(0.5 - sdf / px);

/* ---------------- 主渲染 ---------------- */
const LOGICAL = 1024;   // 逻辑分辨率
const SS = 4;           // 超采样倍数
const N = LOGICAL * SS; // 实际采样网格

// 设计参数（归一化坐标，0~1）
const RR = 0.225;                 // 圆角半径
const CHECK = [                   // 对勾折线三点
  [0.295, 0.545], [0.445, 0.695], [0.745, 0.355],
];
const CR = 0.082;                 // 对勾笔触半径
const BADGE = { x: 0.795, y: 0.215, r: 0.088, ring: 0.028 }; // 提醒徽标
const SHADOW_OFF = 0.018;         // 对勾投影偏移

// 渐变色（左上 → 右下）
const C1 = [0x6d, 0x9b, 0xff];    // 亮靛蓝
const C2 = [0x3d, 0x63, 0xf2];    // 深靛蓝
const mix = (a, b, t) => a + (b - a) * t;

const px1 = 1 / N; // 一个采样步
const img = new Uint8ClampedArray(LOGICAL * LOGICAL * 4);

for (let y = 0; y < LOGICAL; y++) {
  for (let x = 0; x < LOGICAL; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const u = (x * SS + sx + 0.5) / N;
        const v = (y * SS + sy + 0.5) / N;

        // 1) 圆角方块底板
        const plateA = aa(roundRectSDF(u, v, 0.5, 0.5, 0.5, 0.5, RR), px1 * SS);
        if (plateA <= 0) continue;

        // 底色渐变 + 轻微暗角
        const t = clamp01(u * 0.65 + v * 0.35);
        let cr = mix(C1[0], C2[0], t), cg = mix(C1[1], C2[1], t), cb = mix(C1[2], C2[2], t);
        const edge = Math.hypot(u - 0.5, v - 0.5) / 0.707;
        const vig = 1 - edge * edge * 0.10;
        cr *= vig; cg *= vig; cb *= vig;

        // 2) 顶部斜向扫光
        const hi = clamp01(1 - (u * 0.55 + v * 0.85)) * 0.14;
        cr = mix(cr, 255, hi); cg = mix(cg, 255, hi); cb = mix(cb, 255, hi);

        // 3) 对勾投影
        const sh = capsuleDist(u, v, CHECK[0][0] + SHADOW_OFF, CHECK[0][1] + SHADOW_OFF, CHECK[2][0] + SHADOW_OFF, CHECK[2][1] + SHADOW_OFF, CR);
        const shA = aa(sh, px1 * SS) * 0.20;
        cr = mix(cr, 10, shA); cg = mix(cg, 16, shA); cb = mix(cb, 60, shA);

        // 4) 白色对勾本体（两段胶囊并集，内部轻微明度渐变）
        const d1 = capsuleDist(u, v, CHECK[0][0], CHECK[0][1], CHECK[1][0], CHECK[1][1], CR);
        const d2 = capsuleDist(u, v, CHECK[1][0], CHECK[1][1], CHECK[2][0], CHECK[2][1], CR);
        const ckA = Math.max(aa(d1, px1 * SS), aa(d2, px1 * SS));
        if (ckA > 0) {
          const g2 = clamp01((v - 0.30) / 0.45) * 0.10;
          cr = mix(cr, 255 - 14 * g2, ckA);
          cg = mix(cg, 255 - 10 * g2, ckA);
          cb = mix(cb, 255, ckA);
        }

        // 5) 琥珀色提醒徽标（白描边，呼应便签）
        const bd = Math.hypot(u - BADGE.x, v - BADGE.y);
        const ringA = aa(Math.abs(bd - (BADGE.r + BADGE.ring)) - BADGE.ring / 2, px1 * SS);
        if (ringA > 0) { cr = mix(cr, 255, ringA); cg = mix(cg, 255, ringA); cb = mix(cb, 255, ringA); }
        const dotA = aa(bd - BADGE.r, px1 * SS);
        if (dotA > 0) {
          const bt = clamp01((u + v) / 2 - 0.6);
          cr = mix(cr, mix(0xff, 0xf5, bt), dotA);
          cg = mix(cg, mix(0xb4, 0x8e, bt), dotA);
          cb = mix(cb, mix(0x2e, 0x1f, bt), dotA);
        }

        r += cr * plateA; g += cg * plateA; b += cb * plateA; a += plateA;
      }
    }
    const n = SS * SS;
    const i = (y * LOGICAL + x) * 4;
    const cov = a / n;
    img[i] = cov ? r / a : 0;
    img[i + 1] = cov ? g / a : 0;
    img[i + 2] = cov ? b / a : 0;
    img[i + 3] = Math.round(cov * 255);
  }
}
console.log("render done @", LOGICAL, "x", LOGICAL, "(SS", SS + ")");

/* ---------------- 降采样 ---------------- */
/** 面积加权 box 缩放（支持非整数比例，预乘 alpha 处理边缘） */
function downscale(src, sw, dw) {
  const out = Buffer.alloc(dw * dw * 4);
  const scale = sw / dw;
  for (let dy = 0; dy < dw; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      const x0 = dx * scale, x1 = (dx + 1) * scale;
      const y0 = dy * scale, y1 = (dy + 1) * scale;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (wy <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (wx <= 0) continue;
          const w = wx * wy;
          const si = (sy * sw + sx) * 4;
          const al = src[si + 3] / 255;
          r += src[si] * al * w; g += src[si + 1] * al * w; b += src[si + 2] * al * w;
          a += al * w; wsum += w;
        }
      }
      const di = (dy * dw + dx) * 4;
      if (a > 0) {
        out[di] = Math.round(r / a); out[di + 1] = Math.round(g / a); out[di + 2] = Math.round(b / a);
      }
      out[di + 3] = Math.round((a / wsum) * 255);
    }
  }
  return out;
}

/* ---------------- PNG / ICO 编码 ---------------- */
const CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([l, td, c]);
}
function encodePng(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
/** BMP 格式 ICO 图像（BITMAPINFOHEADER + 自底向上 BGRA XOR + AND mask） */
function icoEntry(size, rgba) {
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const si = ((size - 1 - y) * size + x) * 4; // 自底向上
      const di = (y * size + x) * 4;
      xor[di] = rgba[si + 2]; xor[di + 1] = rgba[si + 1]; xor[di + 2] = rgba[si]; xor[di + 3] = rgba[si + 3];
    }
  }
  const andRow = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(andRow * size);
  const h = Buffer.alloc(40);
  h.writeUInt32LE(40, 0); h.writeInt32LE(size, 4); h.writeInt32LE(size * 2, 8);
  h.writeUInt16LE(1, 12); h.writeUInt16LE(32, 14);
  h.writeUInt32LE(xor.length + and.length, 20);
  return Buffer.concat([h, xor, and]);
}
function makeIco(sizes, getRgba) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);  // reserved
  head.writeUInt16LE(1, 2);  // type: icon
  head.writeUInt16LE(sizes.length, 4);
  const dir = Buffer.alloc(16 * sizes.length);
  let off = 6 + 16 * sizes.length;
  const imgs = [];
  sizes.forEach((s, i) => {
    const img = icoEntry(s, getRgba(s));
    const o = i * 16;
    dir[o] = s >= 256 ? 0 : s;
    dir[o + 1] = s >= 256 ? 0 : s;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(img.length, o + 8);
    dir.writeUInt32LE(off, o + 12);
    off += img.length;
    imgs.push(img);
  });
  return Buffer.concat([head, dir, ...imgs]);
}

/* ---------------- 输出 ---------------- */
fs.mkdirSync(OUT, { recursive: true });
const cache = new Map();
const getRgba = (s) => {
  if (!cache.has(s)) cache.set(s, downscale(img, LOGICAL, s));
  return cache.get(s);
};

fs.writeFileSync(path.join(OUT, "icon.png"), encodePng(512, 512, getRgba(512)));
fs.writeFileSync(path.join(OUT, "128x128@2x.png"), encodePng(256, 256, getRgba(256)));
fs.writeFileSync(path.join(OUT, "128x128.png"), encodePng(128, 128, getRgba(128)));
fs.writeFileSync(path.join(OUT, "32x32.png"), encodePng(32, 32, getRgba(32)));
fs.writeFileSync(path.join(OUT, "icon.ico"), makeIco([16, 32, 48, 64, 128, 256], getRgba));
for (const f of fs.readdirSync(OUT)) {
  console.log(" ", f, (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1) + "KB");
}
console.log("icons v2 written to", OUT);
