// Convert medal SVG → PNG for Telegram photos (sharp; falls back to null).
let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

/**
 * @param {string} svg
 * @param {{ width?: number }} [opts]
 * @returns {Promise<Buffer|null>}
 */
async function svgToPngBuffer(svg, opts = {}) {
  if (!sharp || !svg) return null;
  const width = Math.min(1024, Math.max(256, Math.floor(Number(opts.width) || 512)));
  try {
    return await sharp(Buffer.from(String(svg), 'utf8'), { density: 220 })
      .resize(width, Math.round(width * 1.25), { fit: 'contain', background: { r: 11, g: 13, b: 18, alpha: 1 } })
      .png({ compressionLevel: 8 })
      .toBuffer();
  } catch (e) {
    console.error('[medal-png]', e.message || e);
    return null;
  }
}

module.exports = { svgToPngBuffer };
