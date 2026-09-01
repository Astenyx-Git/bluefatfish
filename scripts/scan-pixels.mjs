#!/usr/bin/env node
// scan-pixels.mjs —— 纯 JS PNG 解码（zlib + unfilter），区域像素统计。
// 用途：无图像输入能力时验证截图中宠物渲染（非白像素簇 = 宠物本体；大面积纯黑 = 透明失效）。
// 用法：node scripts/scan-pixels.mjs <png> <x0,y0,x1,y1> [<x0,y0,x1,y1> ...]
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('非 PNG');
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8) throw new Error('bitDepth ' + bitDepth + ' 不支持');
      if (colorType !== 6 && colorType !== 2) throw new Error('colorType ' + colorType + ' 不支持（需 RGBA/RGB）');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  // unfilter（PNG 5 种 filter，逐行还原）
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[dst + x] = v & 0xff;
    }
  }
  return { width, height, bpp, data: out };
}

const [file, ...regions] = process.argv.slice(2);
if (!file || !regions.length) {
  console.error('用法: node scan-pixels.mjs <png> x0,y0,x1,y1 [更多区域]');
  process.exit(2);
}
const img = decodePng(readFileSync(file));
console.log(`PNG ${img.width}x${img.height} bpp=${img.bpp}`);
for (const r of regions) {
  const parts = r.split(',');
  const bboxMode = parts[parts.length - 1] === 'bbox';
  const nums = parts.slice(0, 4).map(Number);
  const x0 = Math.max(0, nums[0]), y0 = Math.max(0, nums[1]);
  const x1 = Math.min(img.width, nums[2]), y1 = Math.min(img.height, nums[3]);
  let total = 0, nonwhite = 0, black = 0;
  let bx0 = Infinity, by0 = Infinity, bx1 = -1, by1 = -1;
  const colors = new Map();
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      const i = (y * img.width + x) * img.bpp;
      const R = img.data[i], G = img.data[i + 1], B = img.data[i + 2];
      total++;
      if (R < 12 && G < 12 && B < 12) { black++; continue; }
      if (!(R > 245 && G > 245 && B > 245)) {
        nonwhite++;
        if (bboxMode) {
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
          if (y < by0) by0 = y;
          if (y > by1) by1 = y;
        }
        const k = ((R >> 4).toString(16) + (G >> 4).toString(16) + (B >> 4).toString(16));
        colors.set(k, (colors.get(k) || 0) + 1);
      }
    }
  }
  const label = bboxMode ? 'bbox' : 'stats';
  console.log(`[${x0},${y0} → ${x1},${y1}] ${label} total=${total} nonwhite=${nonwhite}(${((nonwhite / total) * 100).toFixed(1)}%) black=${black}`);
  if (bboxMode && bx1 >= 0) {
    console.log(`   bbox: x=${bx0}..${bx1} y=${by0}..${by1} (w=${bx1 - bx0} h=${by1 - by0}) center=(${Math.round((bx0 + bx1) / 2)},${Math.round((by0 + by1) / 2)})`);
  } else if (bboxMode) {
    console.log('   bbox: 无非白像素');
  }
  // rows 模式：统计区域内深色（文本）像素的行带分布 —— 数菜单项行数用
  if (parts[parts.length - 1] === 'rows' || bboxMode) {
    const bands = [];
    let cur = null;
    for (let y = y0; y < y1; y++) {
      let dark = 0;
      for (let x = x0; x < x1; x += 2) {
        const i = (y * img.width + x) * img.bpp;
        if (img.data[i] < 120 && img.data[i + 1] < 120 && img.data[i + 2] < 120) dark++;
      }
      if (dark >= 3) {
        if (!cur) cur = { y0: y, y1: y, max: dark };
        else { cur.y1 = y; cur.max = Math.max(cur.max, dark); }
      } else if (cur && y - cur.y1 > 6) {
        bands.push(cur);
        cur = null;
      }
    }
    if (cur) bands.push(cur);
    const merged = bands.filter((b) => b.y1 - b.y0 >= 8);
    console.log(`   文本行带: ${merged.length} 条 → ${merged.map((b) => b.y0 + '-' + b.y1).join(', ')}`);
  }
  const top = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length) console.log('   top色: ' + top.map(([k, v]) => '#' + k + '×' + v).join(' '));
}
