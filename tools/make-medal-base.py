"""Builds the text-free medal bases used by src/medal-art.js.

Input : the approved TOP-1 artwork (flat blue/gold emblem, 1254x1254)
Output: assets/medals/base-top{1,2,3}.jpg  (month / year / "TOP-N" are drawn at runtime as vector text)
TOP-2 = silver + purple, TOP-3 = bronze + green (same artwork, recoloured).
Usage: python3 tools/make-medal-base.py path/to/top1.jpg
"""
import sys, cv2, numpy as np

src = cv2.imread(sys.argv[1])
assert src is not None and src.shape[:2] == (1254, 1254), 'expected the 1254x1254 artwork'
hsv = cv2.cvtColor(src, cv2.COLOR_BGR2HSV)
H, S, V = hsv[..., 0].astype(int) * 2, hsv[..., 1], hsv[..., 2]
gold = ((H > 28) & (H < 64) & (S > 90) & (V > 120)).astype(np.uint8)

def letters(y0, y1, x0, x1, max_w=130, max_h=110):
    """Mask of small gold blobs (the letters) inside the box; long border lines are ignored."""
    sub = gold[y0:y1, x0:x1]
    n, lab, stats, _ = cv2.connectedComponentsWithStats(sub, 8)
    m = np.zeros_like(gold)
    for i in range(1, n):
        x, y, w, h, a = stats[i]
        if w <= max_w and h <= max_h and a >= 25:
            m[y0:y1, x0:x1][lab == i] = 1
    return m

mask = letters(772, 880, 300, 960) | letters(950, 1036, 480, 780)
mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=7)
clean = cv2.inpaint(src, mask * 255, 7, cv2.INPAINT_TELEA)
cv2.imwrite('/tmp/medal/clean_top1.png', clean)

def recolor(img, kind):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
    h = hsv[..., 0] * 2; s = hsv[..., 1] / 255; v = hsv[..., 2] / 255
    goldm = (h > 28) & (h < 64) & (s > 0.35) & (v > 0.22)
    bluem = (h > 195) & (h < 260) & (s > 0.3)
    if kind == 'silver':   # gold -> silver, blue -> purple
        s2 = np.where(goldm, s * 0.10, s); v2 = np.where(goldm, np.minimum(1, v * 1.04 + 0.05), v)
        h2 = np.where(bluem, h + 62, h)
    else:                  # gold -> bronze, blue -> deep green
        h2 = np.where(goldm, 24 + (h - 45) * 0.3, np.where(bluem, h - 100, h))
        s2 = np.where(goldm, np.minimum(1, s * 0.78), s); v2 = np.where(goldm, v * 0.82, v)
    out = np.stack([(h2 % 360) / 2, s2 * 255, v2 * 255], -1).clip(0, 255).astype(np.uint8)
    return cv2.cvtColor(out, cv2.COLOR_HSV2BGR)

for place, img in ((1, clean), (2, recolor(clean, 'silver')), (3, recolor(clean, 'bronze'))):
    out = cv2.resize(img, (800, 800), interpolation=cv2.INTER_AREA)
    cv2.imwrite(f'assets/medals/base-top{place}.jpg', out, [cv2.IMWRITE_JPEG_QUALITY, 90])
print('ok')
