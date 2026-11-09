#!/usr/bin/env python3
"""
Fit the Maltese Gear Cube's sticker outlines to a top-down photo, as constrained parametric sketches.

    python -I tools/maltese/fit_stickers.py PHOTO [--out DIR] [--grid 30] [--old FILE.ts] [--write]

PHOTO is a face-on photo of one face (blue stickers on black plastic), e.g. the shop image
016657-26341.jpg. It is not part of the repo. Needs numpy, scipy, opencv-python, shapely, contourpy and
Pillow.

What it does:
  1. Rectify: find the homography (face -> photo) that makes the blue mask most symmetric under the
     face's own symmetry group D4 (4-fold turns plus mirrors). Writes the rectified face on an n x n
     grid (blueprint).
  2. Average: sample the eight D4 images of the face and average them, so every star / gear in the
     photo contributes and the result is exactly symmetric.
  3. Fit: each sticker is a sketch of straight lines and tangent arcs (sharp corners only at the convex
     points of the star). Its parameters are fitted with a forward model: rasterise the sketch,
     blur it with a fitted Gaussian, compare with the averaged photo pixel by pixel.
  4. Scale: the gear hub lies tan 22.5 deg = 0.41421 of the face half-width from the face centre (the gear
     axes are 22.5 deg off the face normal); that fixes mm per photo unit.
  5. Padding: the largest uniform plastic margin around the stickers that keeps every pair of
     neighbouring pieces apart (gap included) in every gear orientation, by central projection.
  6. Output: a blueprint PNG and report in --out; with --write, the parameter block in
     src/maltese/stickers.ts and reference polygons in tests/maltese/fixtures/sticker-reference.ts.
     --old overlays earlier outlines (a TS file with STAR_OUTLINE / GEAR_OUTLINE arrays, e.g. the old
     src/maltese/outlines.ts from git history) on the blueprint in grey.

The rectification (step 1) takes a few minutes and is cached in --out (homography.json);
--refit-homography redoes it.

The sketch construction below must stay identical to src/maltese/sketch.ts + stickers.ts;
tests/maltese/stickers.test.ts compares the two through the reference polygons.
"""
import argparse
import json
import math
import os
import re
import sys

import contourpy
import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from scipy import optimize
from shapely.geometry import Point, Polygon

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TAN = math.tan(math.pi / 8)  # gear hub / face half-width
COS = math.cos(math.pi / 8)
SIN = math.sin(math.pi / 8)
HUB_Z = 1 / COS
MM = 30.0  # mm per model unit

# Piece dimensions shared with src/maltese/config.ts (mm).
GAP_MM = 0.15  # taken off every piece; two neighbours are 2 x GAP apart
COLUMN_MM = 5.2
COLUMN_STRAIGHT_MM = 2.0  # the column is straight down to this far below the face plane, then coned
PAD_MIN_MM = 0.5

# ------------------------------------------------------------------------------------------------
# Sketch kit (mirror of src/maltese/sketch.ts)

ARC_STEP = math.radians(2.0)


def _v(p):
    return np.asarray(p, dtype=float)


def _cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def _unit(a):
    return a / np.hypot(a[0], a[1])


def _arc(c, r, a0, a1, ccw):
    """Samples of an arc from angle a0 to a1 (exclusive of the start, inclusive of the end)."""
    if ccw:
        while a1 <= a0:
            a1 += 2 * math.pi
    else:
        while a1 >= a0:
            a1 -= 2 * math.pi
    n = max(1, math.ceil(abs(a1 - a0) / ARC_STEP))
    return [c + r * np.array([math.cos(a0 + (a1 - a0) * k / n), math.sin(a0 + (a1 - a0) * k / n)]) for k in range(1, n + 1)]


def _ang(c, p):
    return math.atan2(p[1] - c[1], p[0] - c[0])


class SketchError(ValueError):
    pass


def fillet(a, x, b, r):
    """Tangent arc of radius r in the corner a -> x -> b: (t1, centre, t2, ccw)."""
    d1 = _unit(x - a)
    d2 = _unit(b - x)
    cr = _cross(d1, d2)
    cosang = float(np.clip(-d1 @ d2, -1, 1))
    th = math.acos(cosang)  # interior angle between the two segments
    if th < 1e-6 or th > math.pi - 1e-6:
        raise SketchError('degenerate corner')
    tl = r / math.tan(th / 2)
    if tl > np.hypot(*(x - a)) + 1e-12 or tl > np.hypot(*(b - x)) + 1e-12:
        raise SketchError('fillet does not fit')
    bis = _unit(-d1 + d2)
    c = x + bis * (r / math.sin(th / 2))
    return x - d1 * tl, c, x + d2 * tl, cr > 0


def path(nodes):
    """Closed path through nodes. Each node: {'p': point, 'r': fillet radius} (line into it), or
    {'p': point, 'arc': centre, 'ccw': bool} (an arc around centre ends at it; no fillet at either end).
    Returns the sampled counterclockwise polygon (N x 2)."""
    n = len(nodes)
    entry = [None] * n
    exitp = [None] * n
    fil = [None] * n
    for i, nd in enumerate(nodes):
        prv = nodes[(i - 1) % n]
        nxt = nodes[(i + 1) % n]
        r = nd.get('r', 0.0)
        if r > 0 and 'arc' not in nd and 'arc' not in nxt:
            t1, c, t2, ccw = fillet(_v(prv['p']), _v(nd['p']), _v(nxt['p']), r)
            entry[i], exitp[i], fil[i] = t1, t2, (c, r, ccw)
        else:
            entry[i] = exitp[i] = _v(nd['p'])
    out = []
    for i in range(n):
        j = (i + 1) % n
        nd = nodes[j]
        # segment from exit[i] to entry[j]
        if 'arc' in nd:
            c = _v(nd['arc'])
            r0 = np.hypot(*(exitp[i] - c))
            out += _arc(c, r0, _ang(c, exitp[i]), _ang(c, entry[j]), nd['ccw'])[:-1]
        out.append(entry[j])
        if fil[j] is not None:
            c, r, ccw = fil[j]
            out += _arc(c, r, _ang(c, entry[j]), _ang(c, exitp[j]), ccw)
    return np.array(out)


def mirror_diag(pts):
    return pts[:, ::-1]


# ---- star ----------------------------------------------------------------------------------------
# Face coordinates of the UFR corner's star on F (u right, v up; face centre at the origin): outer
# arms run to the face's top and right edges and end in fins that flare towards the edge midpoints;
# inner arms point at the gears. Mirror-symmetric about u = v; one half is described:
#   hc      centre line of the inner (down) arm, u = hc;   t   its sharp tip at (hc, t)
#   wi      the inner arm's half-width where it meets the outer arm's lower edge
#   yl, yu  lower and upper edge of the outer (right) arm
#   bx, r4  the fin's inner edge leaves the arm's lower edge at u = bx (fillet r4) ...
#   fx, fy  ... and runs straight to the fin's sharp tip
#   ue, ye  the fin's outer edge runs straight from the tip to (ue, ye); the arm ends at u = ue
#   re      the two convex corners at the arm's end
#   r1      inner notch (on the diagonal, between the two inner arms); r2 inner arm root; r3 outer notch
STAR_KEYS = ['hc', 't', 'wi', 'yl', 'yu', 'bx', 'r4', 'fx', 'fy', 'ue', 'ye', 're', 'r1', 'r2', 'r3']


def star_nodes(P):
    hc, t, wi, yl, yu, bx, r4, fx, fy, ue, ye, re_, r1, r2, r3 = (P[k] for k in STAR_KEYS)
    ti = np.array([hc, t])
    qdl = np.array([hc - wi, yl])
    d = qdl - ti
    if abs(d[0] - d[1]) < 1e-12:
        raise SketchError('inner arm side parallel to the diagonal')
    s = (ti[1] - ti[0]) / (d[0] - d[1])
    nn = ti + s * d  # inner notch corner, on the diagonal
    half = [
        {'p': nn, 'r': r1},
        {'p': ti, 'r': 0.0},
        {'p': np.array([hc + wi, yl]), 'r': r2},
        {'p': np.array([bx, yl]), 'r': r4},
        {'p': np.array([fx, fy]), 'r': 0.0},
        {'p': np.array([ue, ye]), 'r': re_},
        {'p': np.array([ue, yu]), 'r': re_},
        {'p': np.array([yu, yu]), 'r': r3},  # outer notch corner, on the diagonal
    ]
    mirrored = [{'p': _v(nd['p'])[::-1], 'r': nd['r']} for nd in half[1:7][::-1]]
    return half + mirrored


def star_path(P):
    return path(star_nodes(P))


# ---- gear ----------------------------------------------------------------------------------------
# Fit frame: hub at the origin, +y outward (towards the edge piece), x lateral. A hub circle (R) with
# four leaf-shaped petals: each petal is bounded by a root circle (r0, at the hub), a tip circle (r1, at
# distance d along the petal) and two convex side arcs of radius rho tangent to both (rho -> infinity
# gives straight sides); concave fillets (rf) join the side arcs to the hub circle. Long pair towards +y
# at +-aL from +y, short pair towards -y at +-aS from -y. Angles in radians.
GEAR_KEYS = ['R', 'rf', 'aL', 'r0L', 'r1L', 'dL', 'rhoL', 'aS', 'r0S', 'r1S', 'dS', 'rhoS']


def _rot(v, th):
    c, s = math.cos(th), math.sin(th)
    return np.array([c * v[0] - s * v[1], s * v[0] + c * v[1]])


def _circle_x(c0, r0, c1, r1, prefer):
    """Intersection of two circles, the one with the larger dot product with `prefer`."""
    dv = c1 - c0
    dd = math.hypot(*dv)
    if dd < 1e-12 or dd > r0 + r1 or dd < abs(r0 - r1):
        raise SketchError('circles do not meet')
    a = (r0 * r0 - r1 * r1 + dd * dd) / (2 * dd)
    h = math.sqrt(max(0.0, r0 * r0 - a * a))
    m = c0 + a * dv / dd
    perp = np.array([-dv[1], dv[0]]) / dd
    p1, p2 = m + h * perp, m - h * perp
    return p1 if p1 @ prefer >= p2 @ prefer else p2


def _petal(th, r0, r1, d, rho, R, rf):
    """Key points of one petal at angle th (in the gear frame)."""
    if not (0 < r0 < R and r1 > 0 and d > r1 and abs(r1 - r0) < d):
        raise SketchError('bad petal')
    if 2 * rho - r0 - r1 < d + 1e-9 or rho <= max(r0, r1):
        raise SketchError('side arc too tight')
    u = np.array([math.cos(th), math.sin(th)])
    C = d * u
    sx = (d * d - (rho - r1) ** 2 + (rho - r0) ** 2) / (2 * d)
    sy2 = (rho - r0) ** 2 - sx * sx
    if sy2 <= 0:
        raise SketchError('side arc does not reach both circles')
    sy = math.sqrt(sy2)
    out = {}
    for side, sgn in (('m', 1.0), ('p', -1.0)):  # minus side (clockwise of the axis): centre on the + side
        S = _rot(np.array([sx, sgn * sy]), th)
        Pt = C + r1 * (C - S) / math.hypot(*(C - S))
        F = _circle_x(np.zeros(2), R + rf, S, rho + rf, u)
        H = F * R / (R + rf)
        L = S + rho * (F - S) / math.hypot(*(F - S))
        # the fillet must touch the side arc between the root and the tip tangent points
        a_root = _ang(S, -r0 * S / math.hypot(*S))
        a_l, a_t = _ang(S, L), _ang(S, Pt)
        if side == 'm':
            span = lambda x: (x - a_root) % (2 * math.pi)
        else:
            span = lambda x: (a_root - x) % (2 * math.pi)
        if not (0 < span(a_l) < span(a_t) < math.pi):
            raise SketchError('fillet runs past the petal tip')
        out[side] = dict(S=S, Pt=Pt, F=F, H=H, L=L)
    out['C'] = C
    out['r1'] = r1
    out['rho'] = rho
    return out


def gear_path(P):
    R, rf = P['R'], P['rf']
    petals = [
        (math.pi / 2 - P['aL'], P['r0L'], P['r1L'], P['dL'], P['rhoL']),
        (math.pi / 2 + P['aL'], P['r0L'], P['r1L'], P['dL'], P['rhoL']),
        (3 * math.pi / 2 - P['aS'], P['r0S'], P['r1S'], P['dS'], P['rhoS']),
        (3 * math.pi / 2 + P['aS'], P['r0S'], P['r1S'], P['dS'], P['rhoS']),
    ]
    parts = [_petal(th, r0, r1, d, rho, R, rf) for th, r0, r1, d, rho in petals]
    O = np.zeros(2)
    out = []
    for i, q in enumerate(parts):
        prev = parts[i - 1]
        a0, a1 = _ang(O, prev['p']['H']), _ang(O, q['m']['H'])
        sweep = (a1 - a0) % (2 * math.pi)
        if sweep <= 1e-4 or sweep >= math.pi:
            raise SketchError('petals overlap on the hub')
        m, p_ = q['m'], q['p']
        out += _arc(O, R, a0, a1, True)
        out += _arc(m['F'], rf, _ang(m['F'], m['H']), _ang(m['F'], m['L']), False)
        out += _arc(m['S'], q['rho'], _ang(m['S'], m['L']), _ang(m['S'], m['Pt']), True)
        out += _arc(q['C'], q['r1'], _ang(q['C'], m['Pt']), _ang(q['C'], p_['Pt']), True)
        out += _arc(p_['S'], q['rho'], _ang(p_['S'], p_['Pt']), _ang(p_['S'], p_['L']), True)
        out += _arc(p_['F'], rf, _ang(p_['F'], p_['L']), _ang(p_['F'], p_['H']), False)
    return np.array(out)


# ------------------------------------------------------------------------------------------------
# Photo: blue score, rectification, D4 average

D4 = [
    lambda u, v: (u, v), lambda u, v: (-v, u), lambda u, v: (-u, -v), lambda u, v: (v, -u),
    lambda u, v: (v, u), lambda u, v: (-u, v), lambda u, v: (-v, -u), lambda u, v: (u, -v),
]


def blue_score(rgb):
    r, b = rgb[..., 0], rgb[..., 2]
    return np.clip(((b - r) - 20.0) / (157.0 - 20.0), 0, 1)


def hom_pts(p, u, v):
    A = p[2:6].reshape(2, 2)
    w = 1 + p[6] * u + p[7] * v
    return np.stack([(A[0, 0] * u + A[0, 1] * v) / w + p[0], (A[1, 0] * u + A[1, 1] * v) / w + p[1]], -1)


def sample(img, P, cval=0.0, order=3):
    return ndi.map_coordinates(img, [P[..., 1], P[..., 0]], order=order, mode='constant', cval=cval)


def rectify(score):
    """Homography face(u, v) -> photo(x, y) that makes the blue mask most D4-symmetric."""
    lab, n = ndi.label(score > 0.5)
    sizes = ndi.sum(np.ones_like(score), lab, range(1, n + 1))
    big = [i + 1 for i in np.argsort(sizes)[::-1][:13]]
    cents = np.array([ndi.center_of_mass(np.ones_like(score), lab, i)[::-1] for i in big])
    c0 = cents.mean(0)
    # The four largest blobs are the stars (towards the face corners).
    stars = cents[:4]
    ang = np.arctan2(stars[:, 1] - c0[1], stars[:, 0] - c0[0])
    th0 = ang[0] - math.pi / 4  # face u axis = star direction - 45 deg (any of the four will do)
    ext = np.hypot(*(stars - c0).T).mean() / (0.58 * math.sqrt(2))  # star blobs' centroids sit near (0.58, 0.58)
    us = np.linspace(-0.95, 0.95, 241)
    U, V = np.meshgrid(us, us)

    def cost(p):
        vals = np.stack([sample(score, hom_pts(p, *T(U, V))) for T in D4])
        return vals.var(0).mean() / max(vals.mean(), 1e-3) ** 2

    best = None
    for dth in np.radians(np.arange(-6, 6.1, 1.5)):
        th = th0 + dth
        eu = np.array([math.cos(th), math.sin(th)])
        ev = np.array([math.sin(th), -math.cos(th)])  # v up in the photo (y down)
        p = np.array([*c0, *(ext * np.stack([eu, ev], 1)).ravel(), 0, 0])
        res = optimize.minimize(lambda q: cost(np.concatenate([q, [0, 0]])), p[:6], method='Nelder-Mead',
                                options=dict(maxiter=20000, xatol=1e-5, fatol=1e-11))
        if best is None or res.fun < best[0]:
            best = (res.fun, np.concatenate([res.x, [0, 0]]))
    p0 = best[1]
    span = np.array([3, 3, 4, 4, 4, 4, 0.08, 0.08])
    res = optimize.minimize(cost, p0, method='Nelder-Mead', bounds=list(zip(p0 - span, p0 + span)),
                            options=dict(maxiter=40000, xatol=1e-7, fatol=1e-13))
    return res.x, res.fun


def averaged(score, p, ext, n):
    us = np.linspace(-ext, ext, n)
    U, V = np.meshgrid(us, us[::-1])  # rows: v from +ext down to -ext
    avg = np.mean([sample(score, hom_pts(p, *T(U, V))) for T in D4], 0)
    return np.clip(avg, 0, 1), us


# ------------------------------------------------------------------------------------------------
# Forward-model fit

class Window:
    """A rectangle of the averaged map: (u0..u1) x (v0..v1), with a pixel domain to compare on."""

    def __init__(self, avg, us, u0, u1, v0, v1):
        step = us[1] - us[0]
        ext = -us[0]
        self.step = step
        c0 = int(round((u0 + ext) / step))
        c1 = int(round((u1 + ext) / step))
        r0 = int(round((ext - v1) / step))
        r1 = int(round((ext - v0) / step))
        self.data = avg[r0:r1, c0:c1]
        self.u0 = us[c0]
        self.v1 = ext - r0 * step  # v of row 0
        self.shape = self.data.shape

    def to_px(self, pts):
        return np.stack([(pts[:, 0] - self.u0) / self.step, (self.v1 - pts[:, 1]) / self.step], 1)

    def px_uv(self):
        h, w = self.shape
        cols, rows = np.meshgrid(np.arange(w), np.arange(h))
        return self.u0 + cols * self.step, self.v1 - rows * self.step

    def set_domain(self, target_pt, near=0.07, avoid=0.02):
        lab, n = ndi.label(self.data > 0.45)
        px = self.to_px(np.array([target_pt]))[0]
        tgt = lab[int(round(px[1])), int(round(px[0]))]
        if tgt == 0:
            raise RuntimeError('target point is not on a sticker')
        dist_t = ndi.distance_transform_edt(lab != tgt) * self.step
        other = (lab > 0) & (lab != tgt)
        dist_o = ndi.distance_transform_edt(~other) * self.step if other.any() else np.full(self.shape, 9.0)
        self.domain = (dist_t < near) & (dist_o > avoid)
        self.target = lab == tgt

    def render(self, poly, ss=4):
        h, w = self.shape
        canvas = np.zeros((h * ss, w * ss), np.uint8)
        px = (self.to_px(poly) + 0.5) * ss - 0.5  # pixel centres at integer coordinates
        cv2.fillPoly(canvas, [np.round(px * 16).astype(np.int32)], 255, lineType=cv2.LINE_8, shift=4)
        return canvas.reshape(h, ss, w, ss).mean((1, 3)) / 255.0


def fit_shape(win, make_poly, keys, x0, lo, hi, sigma0=8.0, penalty=None, n_pen=0):
    """Least squares on pixels: data ~ off + gain * blur(mask(params), sigma). Returns params, sigma, rms.

    The averaged map is ~8x finer than the photo, so the photo's blur is several map pixels wide."""
    D = win.data[win.domain]
    bad = np.concatenate([np.full(D.size, 1.0), np.full(n_pen, 10.0)])

    def resid(x):
        prm = dict(zip(keys, x[:-1]))
        try:
            poly = make_poly(prm)
            extra = penalty(prm) if penalty else np.zeros(0)
        except SketchError:
            return bad
        m = ndi.gaussian_filter(win.render(poly), x[-1])[win.domain]
        A = np.stack([m, np.ones_like(m)], 1)
        coef, *_ = np.linalg.lstsq(A, D, rcond=None)
        return np.concatenate([A @ coef - D, extra])

    lo = np.array([*lo, 1.0])
    hi = np.array([*hi, 20.0])
    x = np.clip(np.array([*x0, sigma0]), lo, hi)
    best = None
    for _ in range(4):  # restart from the result: the finite-difference steps are rescaled each time
        res = optimize.least_squares(resid, x, bounds=(lo, hi), x_scale=(hi - lo) / 10, diff_step=1e-3,
                                     method='trf', max_nfev=600)
        if best is None or res.cost < best.cost - 1e-12:
            best = res
            x = res.x
        else:
            break
    x = best.x
    return dict(zip(keys, x[:-1])), x[-1], float(np.sqrt(np.mean(best.fun[:D.size] ** 2)))


def contour_rms(win, poly):
    """RMS distance (photo units) from the data's 0.5 contour of the target to the fitted outline."""
    U, V = win.px_uv()
    gen = contourpy.contour_generator(U, V, win.data)
    best = None
    pp = Polygon(poly)
    for line in gen.lines(0.5):
        if len(line) < 20:
            continue
        pl = Polygon(line) if len(line) > 3 else None
        if pl is not None and pl.is_valid and pl.contains(pp.representative_point()):
            best = line
    if best is None:
        return float('nan')
    ring = pp.exterior
    keep = [q for q in best if win.domain[int(round((win.v1 - q[1]) / win.step)) % win.shape[0], int(round((q[0] - win.u0) / win.step)) % win.shape[1]]]
    d = np.array([ring.distance(Point(q)) for q in keep])
    return float(np.sqrt(np.mean(d ** 2))) if len(d) else float('nan')


# ------------------------------------------------------------------------------------------------
# Model units, gears in 3D, clearances

def gear_cap_ts(gpoly_fit):
    """Fit frame (+y outward) -> TS cap frame (+y towards the face centre), counterclockwise kept."""
    return -gpoly_fit  # a half turn


def gear_on_face(cap, k):
    """Gear Fr (hub at (tan 22.5, 0) on F) turned k quarter turns: its cap centrally projected onto z = 1."""
    x, y = cap[:, 0], cap[:, 1]
    lx, ly, lz = x, y * COS, HUB_Z - y * SIN
    c, s = [(1, 0), (0, 1), (-1, 0), (0, -1)][k % 4]
    rx, ry = c * lx - s * ly, s * lx + c * ly
    # slot frame columns: X = (0,1,0), Y = (-cos, 0, sin), Z = (sin, 0, cos)
    px = -ry * COS + lz * SIN
    py = rx
    pz = ry * SIN + lz * COS
    return np.stack([px / pz, py / pz], 1)


def column_footprint_centre():
    a = (COLUMN_MM / 2 - GAP_MM) / MM
    z = 1 - COLUMN_STRAIGHT_MM / MM
    h = a / z
    return Polygon([(-h, -h), (h, -h), (h, h), (-h, h)])


def column_footprint_edge_fr():
    """Edge column in the FR edge slot (axis (1,0,1)/sqrt2), its widest section, projected onto z = 1."""
    a = (COLUMN_MM / 2 - GAP_MM) / MM
    r = 1 - COLUMN_STRAIGHT_MM / MM  # widest section: where the straight part ends (same piece frame as a centre)
    d = np.array([1, 0, 1]) / math.sqrt(2)
    ex = np.array([0, 1, 0])
    ey = np.array([-1, 0, 1]) / math.sqrt(2)
    pts = []
    for sx, sy in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
        p = r * d + a * (sx * ex + sy * ey)
        pts.append((p[0] / p[2], p[1] / p[2]))
    return Polygon(pts)


def mirror_poly(pg, fn):
    return Polygon([fn(x, y) for x, y in pg.exterior.coords])


def clearances(star, cap):
    """Smallest sticker-to-sticker (or sticker-to-column) distances on the F face, model units."""
    S = Polygon(star)
    rows = []
    gr = [Polygon(gear_on_face(cap, k)) for k in range(4)]
    gu = [mirror_poly(g, lambda x, y: (y, x)) for g in gr]  # gear Fu (mirror of Fr about u = v)
    for k in range(4):
        rows.append(('star UFR / gear Fr', k, S.distance(gr[k]), 2))
        rows.append(('star UFR / gear Fu', k, S.distance(gu[k]), 2))
        rows.append(('gear Fr / centre column', k, gr[k].distance(column_footprint_centre()), 1))
        rows.append(('gear Fr / FR edge column', k, gr[k].distance(column_footprint_edge_fr()), 1))
        dfr = mirror_poly(S, lambda x, y: (x, -y))
        rows.append(('gear Fr / star DFR', k, dfr.distance(gr[k]), 2))
    for k1 in range(4):
        for k2 in range(4):
            rows.append((f'gear Fr / gear Fu', (k1, k2), gr[k1].distance(gu[k2]), 2))
    rows.append(('star UFR / FR edge column', '-', S.distance(column_footprint_edge_fr()), 1))
    rows.append(('star UFR / star DFR', '-', S.distance(mirror_poly(S, lambda x, y: (x, -y))), 2))
    return rows


def max_padding_mm(rows):
    """Largest padding p with: padded pair -> d >= 2p + 2 gap; sticker vs column -> d >= p + gap."""
    best = math.inf
    worst = None
    for name, k, d, npad in rows:
        dmm = d * MM
        p = (dmm - 2 * GAP_MM) / 2 if npad == 2 else dmm - 2 * GAP_MM
        if p < best:
            best, worst = p, (name, k, dmm)
    return best, worst


# ------------------------------------------------------------------------------------------------
# Old outlines (optional, for the comparison overlay)

def read_old(path):
    if not path or not os.path.exists(path):
        return None
    txt = open(path, encoding='utf8').read()
    out = {}
    for name in ('STAR_OUTLINE', 'GEAR_OUTLINE'):
        m = re.search(name + r'[^=]*=\s*\[(.*?)\];', txt, re.S)
        if m:
            nums = [float(x) for x in re.findall(r'-?\d+\.\d+', m.group(1))]
            out[name] = np.array(nums).reshape(-1, 2)
    return out


# ------------------------------------------------------------------------------------------------
# Main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('photo')
    ap.add_argument('--out', default='fit-out')
    ap.add_argument('--grid', type=int, default=30, help='n for the n x n blueprint grid over the face')
    ap.add_argument('--old', default=None, help='earlier outlines to overlay on the blueprint (TS file)')
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--refit-homography', action='store_true', help='ignore the cached rectification in --out')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    rgb = np.asarray(Image.open(args.photo).convert('RGB')).astype(float)
    score = blue_score(rgb)
    cache = os.path.join(args.out, 'homography.json')
    if os.path.exists(cache) and not args.refit_homography:
        hp, hcost = np.array(json.load(open(cache))['p']), json.load(open(cache))['cost']
    else:
        hp, hcost = rectify(score)  # the slow step (a few minutes); cached in --out
        json.dump({'p': hp.tolist(), 'cost': hcost}, open(cache, 'w'))
    print(f'rectified: centre ({hp[0]:.2f}, {hp[1]:.2f}) px, perspective ({hp[6]:+.4f}, {hp[7]:+.4f}), symmetry cost {hcost:.4f}')

    ext = 1.18
    avg, us = averaged(score, hp, ext, 945)

    # ---- gear (on the +v axis, long petals towards +v)
    gw = Window(avg, us, -0.42, 0.42, 0.10, 1.00)
    gw.set_domain((0.0, 0.52))
    gkeys = ['hv'] + GEAR_KEYS
    #       hv    R      rf     aL                r0L    r1L    dL    rhoL  aS                r0S    r1S    dS    rhoS
    gx0 = [0.49, 0.060, 0.020, math.radians(40), 0.014, 0.056, 0.29, 2.00, math.radians(43), 0.018, 0.054, 0.23, 2.00]
    glo = [0.44, 0.035, 0.004, math.radians(25), 0.004, 0.025, 0.20, 0.35, math.radians(28), 0.004, 0.025, 0.14, 0.35]
    ghi = [0.56, 0.090, 0.050, math.radians(55), 0.045, 0.100, 0.40, 50.0, math.radians(58), 0.045, 0.100, 0.33, 50.0]

    def gear_photo(prm):
        return gear_path(prm) + np.array([0.0, prm['hv']])

    gprm, gsig, grms = fit_shape(gw, gear_photo, gkeys, gx0, glo, ghi)
    hv = gprm['hv']
    scale = TAN / hv  # model units per photo unit
    print(f'gear: hub at {hv:.4f} photo units -> {scale * MM:.3f} mm per unit; pixel rms {grms:.4f}, blur {gsig:.2f} px')

    # ---- star (in the +u, +v quadrant)
    sw = Window(avg, us, 0.08, 1.16, 0.08, 1.16)
    sw.set_domain((0.49, 0.49))
    #       hc    t     wi     yl     yu     bx    r4     fx    fy    ue    ye    re     r1     r2     r3
    sx0 = [0.49, 0.15, 0.075, 0.445, 0.535, 0.68, 0.060, 0.89, 0.15, 1.05, 0.47, 0.020, 0.050, 0.070, 0.050]
    slo = [0.42, 0.08, 0.030, 0.400, 0.480, 0.56, 0.004, 0.78, 0.06, 0.95, 0.38, 0.003, 0.004, 0.004, 0.004]
    shi = [0.56, 0.30, 0.120, 0.490, 0.600, 0.84, 0.200, 1.00, 0.32, 1.15, 0.53, 0.060, 0.150, 0.150, 0.150]
    sprm, ssig, srms = fit_shape(sw, star_path, STAR_KEYS, sx0, slo, shi)
    print(f'star: pixel rms {srms:.4f}, blur {ssig:.2f} px')

    gear_m = {k: (v if k in ('aL', 'aS') else v * scale) for k, v in gprm.items() if k != 'hv'}
    cap_poly = gear_cap_ts(gear_path(gear_m))
    to_model = lambda prm: {k: v * scale for k, v in prm.items()}

    # ---- padding: the largest that fits the stickers as fitted; at least PAD_MIN_MM, trimming the
    # star's pointed inner tips (the only thing that limits it) just enough if that is needed.
    pad_free, worst = max_padding_mm(clearances(star_path(to_model(sprm)), cap_poly))
    print(f'untrimmed: largest padding {pad_free:.3f} mm (limited by {worst[0]} k={worst[1]}, {worst[2]:.3f} mm apart)')
    pad_q = max(PAD_MIN_MM, math.floor(pad_free / 0.05 + 1e-9) * 0.05)
    trim_mm = 0.0
    if pad_free < pad_q:
        need = (2 * pad_q + 2 * GAP_MM) / MM

        def tip_clear(t):
            try:
                S = Polygon(star_path(to_model(dict(sprm, t=t))))
            except SketchError:
                return -1.0  # the shortened arm no longer has room for its root fillets
            return min(S.distance(Polygon(gear_on_face(cap_poly, k))) for k in range(4))

        lo_t, hi_t = sprm['t'], sprm['t']
        while hi_t < sprm['yl'] - 0.02 and tip_clear(hi_t) < need:
            hi_t += 0.005
        if tip_clear(hi_t) < need:
            raise SystemExit('trimming the inner tips is not enough for the minimum padding')
        for _ in range(40):
            mid = (lo_t + hi_t) / 2
            lo_t, hi_t = (mid, hi_t) if tip_clear(mid) < need else (lo_t, mid)
        trim_mm = (hi_t - sprm['t']) * scale * MM

        # Refit the whole star from the trimmed start, now with the clearance as a hard-ish penalty
        # (200 per mm of violation, at each gear orientation), so the rest of the shape can adapt.
        def pen(prm):
            S = Polygon(star_path(to_model(prm)))
            return np.array([200 * MM * max(0.0, need - S.distance(Polygon(gear_on_face(cap_poly, k)))) for k in range(4)])

        x2 = [hi_t if k == 't' else sprm[k] for k in STAR_KEYS]
        sprm, ssig, srms = fit_shape(sw, star_path, STAR_KEYS, x2, slo, shi, sigma0=ssig, penalty=pen, n_pen=4)
        if tip_clear(sprm['t']) < need - 1e-4 / MM:
            raise SystemExit('constrained refit still violates the clearance')
        print(f'inner tips trimmed {trim_mm:.2f} mm for {pad_q:.2f} mm padding; star refit pixel rms {srms:.4f}')

    # ---- to model units
    star_m = to_model(sprm)
    star_poly = star_path(star_m)
    c_star = contour_rms(sw, star_path(sprm)) * scale * MM
    c_gear = contour_rms(gw, gear_photo(gprm)) * scale * MM
    print(f'contour rms: star {c_star:.3f} mm, gear {c_gear:.3f} mm')

    rows = clearances(star_poly, cap_poly)
    pad, worst = max_padding_mm(rows)
    print(f'final: padding {pad_q:.2f} mm; tightest {worst[0]} k={worst[1]}, {worst[2]:.3f} mm apart (fits up to {pad:.3f} mm)')
    if pad + 1e-6 < pad_q:
        raise SystemExit('padding does not fit')

    report = {
        'homography': hp.tolist(),
        'mm_per_photo_unit': scale * MM,
        'gear_fit': {k: float(v) for k, v in gprm.items()},
        'star_fit': {k: float(v) for k, v in sprm.items()},
        'pixel_rms': {'star': srms, 'gear': grms},
        'contour_rms_mm': {'star': c_star, 'gear': c_gear},
        'blur_px': {'star': ssig, 'gear': gsig},
        'padding_mm': pad_q, 'padding_fits_up_to_mm': pad, 'padding_untrimmed_mm': pad_free, 'inner_tip_trim_mm': trim_mm,
        'clearances_mm': [(n, str(k), d * MM) for n, k, d, _ in rows],
    }
    json.dump(report, open(os.path.join(args.out, 'fit-report.json'), 'w'), indent=1)

    blueprint(args, rgb, hp, scale, star_m, gear_m, pad_q, read_old(args.old))

    if args.write:
        write_ts(star_m, gear_m, pad_q, scale)
        # The gear's reference polygon is written by trace_gear.py (the gear is traced from a drawing);
        # the photo-fitted gear here only fixes the scale and the stars' clearance.
        fx_ts = os.path.join(ROOT, 'tests', 'maltese', 'fixtures', 'sticker-reference.ts')
        old_gear = [[0.0, 0.0]]
        if os.path.exists(fx_ts):
            m = re.search(r'  gear: \[(.*?)\n  \],', open(fx_ts, encoding='utf8').read(), re.S)
            if m:
                old_gear = [[float(a), float(b)] for a, b in re.findall(r'\[([-\d.e]+), ([-\d.e]+)\]', m.group(1))]
        ref = {
            'star': star_poly.round(7).tolist(),
            'gear': old_gear,
        }
        fx = os.path.join(ROOT, 'tests', 'maltese', 'fixtures')
        os.makedirs(fx, exist_ok=True)
        nl = '\n'

        def fmt(poly):
            rows = ('    [' + ', '.join(f'{v:.7f}' for v in pt) + '],' for pt in poly)
            return '[' + nl + nl.join(rows) + nl + '  ]'

        ts = (
            '// Generated by tools/maltese/fit_stickers.py --write: the fitted sticker outlines (model units), so' + nl
            + '// tests/maltese/stickers.test.ts can check that src/maltese/stickers.ts rebuilds them.' + nl
            + 'export const STICKER_REFERENCE: { readonly star: readonly (readonly [number, number])[]; '
            + 'readonly gear: readonly (readonly [number, number])[] } = {' + nl
            + '  star: ' + fmt(ref['star']) + ',' + nl
            + '  gear: ' + fmt(ref['gear']) + ',' + nl
            + '};' + nl
        )
        open(os.path.join(fx, 'sticker-reference.ts'), 'w', encoding='utf8', newline=nl).write(ts)
        print('wrote src/maltese/stickers.ts parameter block and tests/maltese/fixtures/sticker-reference.ts')


def blueprint(args, rgb, hp, scale, star_m, gear_m, pad_mm, old, cap_override=None, name='blueprint.png'):
    """The rectified face on an n x n grid (2 mm cells for n = 30) with the fitted outlines."""
    px_per_mm = 12
    half_mm = 31.0
    N = int(2 * half_mm * px_per_mm)
    mm = np.linspace(-half_mm, half_mm, N)
    X, Y = np.meshgrid(mm, mm[::-1])
    u = X / MM / scale  # photo units
    v = Y / MM / scale
    P = hom_pts(hp, u, v)
    img = np.stack([sample(rgb[..., c], P, cval=255.0) for c in range(3)], -1)
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).convert('RGB')
    im = Image.blend(im, Image.new('RGB', im.size, (255, 255, 255)), 0.35)
    d = ImageDraw.Draw(im)
    to = lambda x, y: ((x * MM + half_mm) * px_per_mm, (half_mm - y * MM) * px_per_mm)  # model -> px
    cell = 2 * MM / args.grid
    for i in range(args.grid + 1):
        q = -MM + i * cell
        bold = abs(q / 10 - round(q / 10)) < 1e-6
        col = (90, 90, 200) if bold else (170, 170, 220)
        d.line([to(q / MM, -1), to(q / MM, 1)], fill=col, width=2 if bold else 1)
        d.line([to(-1, q / MM), to(1, q / MM)], fill=col, width=2 if bold else 1)
        if bold:
            d.text((to(q / MM, -1)[0] + 3, to(0, -1)[1] + 3), f'{q:.0f}', fill=(40, 40, 140))
            d.text((to(-1, q / MM)[0] - 22, to(0, q / MM)[1] + 2), f'{q:.0f}', fill=(40, 40, 140))

    def poly_px(pts):
        return [to(x, y) for x, y in pts]

    sym = [lambda p: p, lambda p: np.stack([-p[:, 1], p[:, 0]], 1), lambda p: -p, lambda p: np.stack([p[:, 1], -p[:, 0]], 1)]
    star = star_path(star_m)
    cap = cap_override if cap_override is not None else gear_cap_ts(gear_path(gear_m))
    gF = gear_on_face(cap, 0)  # gear Fr at k = 0
    centre = (COLUMN_MM / 2 - GAP_MM - pad_mm) / MM
    sq = np.array([[-centre, -centre], [centre, -centre], [centre, centre], [-centre, centre]])
    pad = pad_mm / MM
    for f in sym:
        for shape in (star, gF):
            pts = f(shape)
            plate = Polygon(pts).buffer(pad, 32)
            d.line(poly_px(np.array(plate.exterior.coords)), fill=(255, 150, 0), width=1)
            d.line(poly_px(np.vstack([pts, pts[:1]])), fill=(230, 0, 0), width=2)
            if old is not None:
                o = old['STAR_OUTLINE'] if shape is star else gear_on_face(old['GEAR_OUTLINE'], 0)
                o = f(o)
                d.line(poly_px(np.vstack([o, o[:1]])), fill=(110, 110, 110), width=1)
    d.line(poly_px(np.vstack([sq, sq[:1]])), fill=(230, 0, 0), width=2)
    d.text((8, 8), f'Maltese Gear Cube, face F rectified: {args.grid}x{args.grid} grid ({2 * MM / args.grid:g} mm cells), '
                   f'red = fitted stickers, orange = plateaus (padding {pad_mm:.2f} mm), grey = old outlines',
           fill=(0, 0, 0))
    out = os.path.join(args.out, name)
    im.save(out)
    print('blueprint:', out)


def write_ts(star_m, gear_m, pad_mm, scale):
    path_ts = os.path.join(ROOT, 'src', 'maltese', 'stickers.ts')
    txt = open(path_ts, encoding='utf8').read()
    mm = lambda v: f'{v * MM:.4f}'
    lines = ['// <generated> by tools/maltese/fit_stickers.py (re-run it to change these numbers)']
    lines.append('export const STAR_MM = {')
    for k in STAR_KEYS:
        lines.append(f'  {k}: {mm(star_m[k])},')
    lines.append('} as const;')
    lines.append(f'export const PADDING_MM = {pad_mm:.2f};')
    lines.append('// </generated>')
    block = '\n'.join(lines)
    new = re.sub(r'// <generated>.*?// </generated>', block, txt, flags=re.S)
    if new == txt and block not in txt:
        raise SystemExit('generated markers not found in src/maltese/stickers.ts')
    open(path_ts, 'w', encoding='utf8', newline='\n').write(new)


if __name__ == '__main__':
    main()
