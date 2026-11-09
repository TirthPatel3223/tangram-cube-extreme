#!/usr/bin/env python3
"""
Trace the Maltese Gear Cube's gear sticker from a drawing, and size it from the top-down photo.

    python -I tools/maltese/trace_gear.py GEAR_IMAGE PHOTO [--out DIR] [--write]

GEAR_IMAGE is a clean silhouette of one gear sticker (blue on white, e.g. the user's gear_final.jpg):
two long teeth and two short ones, mirror-symmetric about the axis between each pair. PHOTO is the
top-down shop photo that tools/maltese/fit_stickers.py fitted the stars to; it fixes the gear's size.
Neither image is in the repo.

What it does:
  1. Axis: the mirror line that maps the silhouette onto itself best (sub-pixel Nelder-Mead).
  2. Hub: on that line, the centre of the largest circle that fits in the gear's middle (where the
     four teeth meet), i.e. the X's crossing; the gear spins about it.
  3. Outline: the silhouette is resampled in the gear's frame as a signed distance field, averaged
     with its mirror image (exactly symmetric), contoured with sub-pixel accuracy, passed through a
     light smoothing spline (0.1 px: JPEG wobble only) and resampled evenly.
  4. Size: the outline is placed on the photo's gears (hub where fit_stickers.py found it, long teeth
     towards the edge) and only its scale is fitted, with the same forward model (rasterise, blur,
     compare pixels). The stars are left exactly as they are.
  5. Clearance: against the fitted star (read from src/maltese/stickers.ts), the columns and the
     neighbouring gear, in every gear orientation, with the padding in stickers.ts.
  6. Output: the outline (mm, gear cap frame) between the `// <gear>` markers in stickers.ts, and the
     gear's reference polygon in tests/maltese/fixtures/sticker-reference.ts.
"""
import argparse
import json
import math
import os
import re
import sys

import contourpy
import numpy as np
from PIL import Image, ImageDraw
from scipy import interpolate
from scipy import ndimage as ndi
from scipy import optimize
from shapely.geometry import Polygon

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fit_stickers as F  # noqa: E402

ROOT = F.ROOT
MM = F.MM


def silhouette(path):
    im = np.asarray(Image.open(path).convert('RGB')).astype(float)
    r, b = im[..., 0], im[..., 2]
    # Blue on white: b - r is ~150 on the sticker, 0 on the paper.
    return np.clip((b - r - 30.0) / 120.0, 0, 1)


def mirror_axis(score):
    """Line (point c, unit direction d) about which the silhouette is most symmetric."""
    H, W = score.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    ys, xs = np.nonzero(score > 0.5)

    def cost(p):
        cx, cy, th = p
        d = np.array([math.cos(th), math.sin(th)])
        px, py = xx - cx, yy - cy
        t = px * d[0] + py * d[1]
        m = ndi.map_coordinates(score, [2 * t * d[1] - py + cy, 2 * t * d[0] - px + cx], order=1, cval=0)
        return float(np.mean((m - score) ** 2))

    best = None
    for th0 in np.radians(np.arange(0, 180, 15)):
        res = optimize.minimize(cost, [xs.mean(), ys.mean(), th0], method='Nelder-Mead',
                                options=dict(xatol=1e-5, fatol=1e-12, maxiter=6000))
        if best is None or res.fun < best.fun:
            best = res
    cx, cy, th = best.x
    return np.array([cx, cy]), np.array([math.cos(th), math.sin(th)]), best.fun


def gear_frame(score, c, d):
    """Unit vectors (image coordinates) of the gear frame: +y outward (between the long teeth), x lateral."""
    # The long teeth reach farther: outward is the way along the axis with more far-reaching ink.
    ys, xs = np.nonzero(score > 0.5)
    t = (xs - c[0]) * d[0] + (ys - c[1]) * d[1]
    s = (xs - c[0]) * -d[1] + (ys - c[1]) * d[0]
    # Teeth sit at about ±45° off the axis: compare the reach of the two halves (t > 0 vs t < 0).
    reach_pos = np.hypot(t[t > 0], s[t > 0]).max()
    reach_neg = np.hypot(t[t < 0], s[t < 0]).max()
    ey = d if reach_pos > reach_neg else -d
    # Right-handed as seen in the picture (image y points down): x = ey turned 90° clockwise on screen.
    ex = np.array([-ey[1], ey[0]])
    return ex, ey


def hub_on_axis(score, c, ey):
    """Centre of the largest circle centred on the axis that fits inside the gear's middle."""
    inside = ndi.distance_transform_edt(score > 0.5)
    ts = np.linspace(-150, 150, 3001)
    pts = c[None, :] + ts[:, None] * ey[None, :]
    dist = ndi.map_coordinates(inside, [pts[:, 1], pts[:, 0]], order=1)
    # The middle lies between the two notches on the axis (where the distance dips to ~0 at the ends);
    # take the best point within the central stretch.
    k = int(np.argmax(np.where(np.abs(ts) < 60, dist, -1)))
    # Refine: the distance along the axis is flat-topped; take the middle of the near-maximal stretch.
    good = np.nonzero((dist >= dist[k] - 0.25) & (np.abs(ts) < 60))[0]
    t0 = float(ts[good].mean())
    return c + t0 * ey, float(dist[k])


def traced_outline(score, hub, ex, ey, half_px, step=0.25):
    """The gear's outline in the gear frame (image px, hub at the origin), exactly mirror-symmetric.

    The silhouette is resampled in the gear frame and turned into a signed distance field; that field is
    averaged with its mirror image (averaging the silhouettes themselves would leave a flat 50% band
    wherever the drawing is a little lopsided, and the contour would wander in it)."""
    n = int(round(2 * half_px / step)) + 1
    u = np.linspace(-half_px, half_px, n)
    X, Y = np.meshgrid(u, u[::-1])  # rows: y from +half down
    P = hub[None, None, :] + X[..., None] * ex[None, None, :] + Y[..., None] * ey[None, None, :]
    S = ndi.map_coordinates(score, [P[..., 1], P[..., 0]], order=3, cval=0)
    inside = S > 0.5
    sdf = (ndi.distance_transform_edt(~inside) - ndi.distance_transform_edt(inside)) * step
    sym = 0.5 * (sdf + sdf[:, ::-1])
    gen = contourpy.contour_generator(X, Y, sym)
    lines = [ln for ln in gen.lines(0.0) if len(ln) > 50]
    poly = np.asarray(max(lines, key=lambda ln: Polygon(ln).area))
    if not Polygon(poly).exterior.is_ccw:
        poly = poly[::-1]
    return poly


def spline_smooth(poly, rms_px=0.1, samples=4000):
    """A periodic cubic smoothing spline through the contour (removes pixel-level wobble only)."""
    rr = resample_closed(poly, 1600)
    tck, _ = interpolate.splprep([rr[:, 0], rr[:, 1]], s=len(rr) * rms_px ** 2, per=1, k=3)
    x, y = interpolate.splev(np.linspace(0, 1, samples, endpoint=False), tck)
    return np.stack([x, y], 1)


def resample_closed(poly, n):
    p = np.vstack([poly, poly[:1]])
    seg = np.hypot(*np.diff(p, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    t = np.linspace(0, s[-1], n, endpoint=False)
    return np.stack([np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])], 1)


def symmetric_resample(poly, n_half):
    """An exactly mirror-symmetric, counterclockwise polygon: the right half (x >= 0) and its mirror."""
    n = len(poly)
    i_top = min((i for i in range(n) if poly[i, 1] > 0), key=lambda i: abs(poly[i, 0]))
    i_bot = min((i for i in range(n) if poly[i, 1] < 0), key=lambda i: abs(poly[i, 0]))
    # Counterclockwise, the right side runs up from the bottom crossing to the top one.
    idx = [(i_bot + k) % n for k in range((i_top - i_bot) % n + 1)]
    right = poly[idx].copy()
    if right[:, 0].mean() < 0:
        raise SystemExit('outline is not counterclockwise')
    right[0, 0] = 0.0
    right[-1, 0] = 0.0
    right = resample_closed_open(right, n_half)
    right[:, 0] = np.maximum(right[:, 0], 0.0)
    left = (right[::-1] * np.array([-1.0, 1.0]))[1:-1]
    return np.vstack([right, left])


def symmetric_adaptive(poly, max_step, max_turn_deg=5.0):
    """Exactly mirror-symmetric, counterclockwise polygon from a dense smooth outline: points no farther
    apart than max_step and no more than max_turn_deg of turn apart (dense at the pointed tooth tips)."""
    n = len(poly)
    i_top = min((i for i in range(n) if poly[i, 1] > 0), key=lambda i: abs(poly[i, 0]))
    i_bot = min((i for i in range(n) if poly[i, 1] < 0), key=lambda i: abs(poly[i, 0]))
    idx = [(i_bot + k) % n for k in range((i_top - i_bot) % n + 1)]
    right = poly[idx].copy()
    if right[:, 0].mean() < 0:
        raise SystemExit('outline is not counterclockwise')
    right[0, 0] = 0.0
    right[-1, 0] = 0.0
    keep = [right[0]]
    lim = math.radians(max_turn_deg)
    m = len(right)
    seg = [float(np.hypot(*(right[i + 1] - right[i]))) for i in range(m - 1)]

    def bend(i):  # turn at dense point i
        if i <= 0 or i >= m - 1:
            return 0.0
        a = right[i] - right[i - 1]
        b = right[i + 1] - right[i]
        return abs(math.atan2(a[0] * b[1] - a[1] * b[0], a @ b))

    run = 0.0
    turn = 0.0
    for i in range(1, m):
        run += seg[i - 1]
        turn += bend(i)
        last = i == m - 1
        # Look ahead: stop here if one more dense step would break either limit.
        if last or run + seg[i] > max_step or turn + bend(i + 1) > lim:
            keep.append(right[i])
            run = 0.0
            turn = 0.0
    half = np.array(keep)
    half[:, 0] = np.maximum(half[:, 0], 0.0)
    left = (half[::-1] * np.array([-1.0, 1.0]))[1:-1]
    return np.vstack([half, left])


def resample_closed_open(p, n):
    seg = np.hypot(*np.diff(p, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    t = np.linspace(0, s[-1], n)
    return np.stack([np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])], 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('gear')
    ap.add_argument('photo')
    ap.add_argument('--out', default='fit-out')
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--step-mm', type=float, default=0.1, help='largest spacing of the outline points')
    ap.add_argument('--turn-deg', type=float, default=5.0, help='largest turn between outline points')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    # ---- 1-3: trace the drawing
    score = silhouette(args.gear)
    c, d, cost = mirror_axis(score)
    ex, ey = gear_frame(score, c, d)
    hub, r_hub = hub_on_axis(score, c, ey)
    print(f'axis through ({c[0]:.2f}, {c[1]:.2f}) px at {math.degrees(math.atan2(d[1], d[0])):.2f} deg '
          f'(mirror misfit {cost:.4f}); hub ({hub[0]:.2f}, {hub[1]:.2f}) px, inscribed radius {r_hub:.1f} px')
    half = 1.05 * np.hypot(*(np.argwhere(score.T > 0.5) - hub).T).max()
    raw = traced_outline(score, hub, ex, ey, half)
    dense = spline_smooth(raw, samples=8000)
    # First pass in pixels; the 0.1 mm spacing is set once the size is known (below).
    out_px = symmetric_adaptive(dense, 3.0)
    reach = np.hypot(*out_px.T)
    long_px = reach[out_px[:, 1] > 0].max()
    short_px = reach[out_px[:, 1] < 0].max()
    print(f'teeth: long reach {long_px:.1f} px, short {short_px:.1f} px (ratio {long_px / short_px:.3f})')

    # ---- 4: size it on the photo's gears (hub fixed where the star fit put it)
    rgb = np.asarray(Image.open(args.photo).convert('RGB')).astype(float)
    pscore = F.blue_score(rgb)
    cache = os.path.join(args.out, 'homography.json')
    if os.path.exists(cache):
        hp = np.array(json.load(open(cache))['p'])
    else:
        hp, _ = F.rectify(pscore)
        json.dump({'p': hp.tolist(), 'cost': 0.0}, open(cache, 'w'))
    avg, us = F.averaged(pscore, hp, 1.18, 945)
    gw = F.Window(avg, us, -0.42, 0.42, 0.10, 1.00)
    gw.set_domain((0.0, 0.52))
    # The hub position (and so the mm scale shared with the stars) comes from the photo fit.
    gkeys = ['hv'] + F.GEAR_KEYS
    gx0 = [0.49, 0.060, 0.020, math.radians(40), 0.014, 0.056, 0.29, 2.00, math.radians(43), 0.018, 0.054, 0.23, 2.00]
    glo = [0.44, 0.035, 0.004, math.radians(25), 0.004, 0.025, 0.20, 0.35, math.radians(28), 0.004, 0.025, 0.14, 0.35]
    ghi = [0.56, 0.090, 0.050, math.radians(55), 0.045, 0.100, 0.40, 50.0, math.radians(58), 0.045, 0.100, 0.33, 50.0]
    gprm, _, _ = F.fit_shape(gw, lambda p: F.gear_path(p) + np.array([0.0, p['hv']]), gkeys, gx0, glo, ghi)
    hv = gprm['hv']
    mm_per_unit = F.TAN / hv * MM
    print(f'photo: hub at {hv:.4f} photo units = {mm_per_unit:.3f} mm per photo unit (as for the stars)')

    def template(prm):
        return out_px * prm['s'] + np.array([0.0, hv])

    sprm, sig, rms = F.fit_shape(gw, template, ['s'], [9.0 / mm_per_unit / long_px], [0.5 * 9.0 / mm_per_unit / long_px],
                                 [2.0 * 9.0 / mm_per_unit / long_px], sigma0=8.0)
    px_mm = sprm['s'] * mm_per_unit  # mm per drawing pixel
    out_px = symmetric_adaptive(dense, args.step_mm / px_mm, args.turn_deg)
    outline_mm = out_px * px_mm
    print(f'outline: {len(out_px)} points (at most {args.step_mm} mm and {args.turn_deg}° apart)')
    print(f'size: {px_mm * 1000:.2f} µm per drawing pixel; long teeth {long_px * px_mm:.2f} mm, short '
          f'{short_px * px_mm:.2f} mm from the hub; photo pixel rms {rms:.4f} (blur {sig:.2f} px)')

    # ---- 5: clearances with the fitted star, the columns and the neighbouring gear
    star_mm = read_star_mm()
    star_poly = F.star_path({k: v / MM for k, v in star_mm.items()})
    cap = -(outline_mm / MM)  # fit frame (+y outward) -> cap frame (+y towards the face centre)
    rows = F.clearances(star_poly, cap)
    pad_mm = read_padding_mm()
    pad_fit, worst = F.max_padding_mm(rows)
    print(f'clearance: padding {pad_mm:.2f} mm fits up to {pad_fit:.3f} mm '
          f'(tightest: {worst[0]} k={worst[1]}, {worst[2]:.3f} mm apart)')
    for name, k, dist, npad in sorted(rows, key=lambda r: r[2])[:6]:
        print(f'   {name:26s} k={str(k):8s} {dist * MM:.3f} mm')

    report = {
        'axis': {'point_px': c.tolist(), 'dir': d.tolist(), 'mirror_misfit': cost},
        'hub_px': hub.tolist(), 'hub_radius_px': r_hub,
        'mm_per_px': px_mm, 'long_mm': long_px * px_mm, 'short_mm': short_px * px_mm,
        'photo_pixel_rms': rms, 'padding_fits_up_to_mm': pad_fit,
        'clearances_mm': [(n, str(k), dd * MM) for n, k, dd, _ in rows],
    }
    json.dump(report, open(os.path.join(args.out, 'gear-report.json'), 'w'), indent=1)
    preview(args, score, hub, ex, ey, out_px)
    F.blueprint(argparse.Namespace(out=args.out, grid=30), rgb, hp, F.TAN / hv, {k: v / MM for k, v in star_mm.items()},
                None, pad_mm, None, cap_override=cap, name='blueprint-traced-gear.png')
    if pad_fit + 1e-9 < pad_mm:
        raise SystemExit('the traced gear does not leave room for the padding: not written')

    if args.write:
        write_gear(outline_mm, cap)
        print('wrote the gear outline into src/maltese/stickers.ts and tests/maltese/fixtures/sticker-reference.ts')


def read_star_mm():
    txt = open(os.path.join(ROOT, 'src', 'maltese', 'stickers.ts'), encoding='utf8').read()
    block = re.search(r'export const STAR_MM = \{(.*?)\} as const;', txt, re.S).group(1)
    return {k: float(v) for k, v in re.findall(r'(\w+): ([-\d.]+)', block)}


def read_padding_mm():
    txt = open(os.path.join(ROOT, 'src', 'maltese', 'stickers.ts'), encoding='utf8').read()
    return float(re.search(r'export const PADDING_MM = ([\d.]+);', txt).group(1))


def preview(args, score, hub, ex, ey, out_px):
    """The drawing with the traced, symmetrised outline on top (for review)."""
    im = Image.fromarray((255 - 120 * score).astype(np.uint8)).convert('RGB')
    dr = ImageDraw.Draw(im)
    pts = [tuple(hub + p[0] * ex + p[1] * ey) for p in out_px]
    dr.line(pts + [pts[0]], fill=(220, 0, 0), width=2)
    dr.ellipse([hub[0] - 3, hub[1] - 3, hub[0] + 3, hub[1] + 3], fill=(0, 0, 0))
    a, b = hub - 260 * ey, hub + 260 * ey
    dr.line([tuple(a), tuple(b)], fill=(0, 150, 0), width=1)
    im.save(os.path.join(args.out, 'gear-trace.png'))


def write_gear(outline_mm, cap):
    """Outline in the TS cap frame (+y towards the face centre): a half turn of the fit frame."""
    cap_mm = -outline_mm
    p = os.path.join(ROOT, 'src', 'maltese', 'stickers.ts')
    txt = open(p, encoding='utf8').read()
    z = lambda v: 0.0 if abs(v) < 5e-5 else v  # no '-0.0000'
    rows = [f'  {z(x):.4f}, {z(y):.4f},' for x, y in cap_mm]
    block = ('// <gear> by tools/maltese/trace_gear.py from the user\'s gear drawing (re-run it to change)\n'
             'export const GEAR_OUTLINE_MM: readonly number[] = [\n' + '\n'.join(rows) + '\n];\n// </gear>')
    new = re.sub(r'// <gear>.*?// </gear>', lambda _: block, txt, flags=re.S)
    if new == txt and block not in txt:
        raise SystemExit('gear markers not found in src/maltese/stickers.ts')
    open(p, 'w', encoding='utf8', newline='\n').write(new)
    fx = os.path.join(ROOT, 'tests', 'maltese', 'fixtures', 'sticker-reference.ts')
    t = open(fx, encoding='utf8').read()
    nl = '\n'
    gear_rows = nl.join('    [' + ', '.join(f'{v:.7f}' for v in pt) + '],' for pt in cap)
    t = re.sub(r'  gear: \[.*?\n  \],', lambda _: '  gear: [' + nl + gear_rows + nl + '  ],', t, flags=re.S)
    open(fx, 'w', encoding='utf8', newline=nl).write(t)


if __name__ == '__main__':
    main()
