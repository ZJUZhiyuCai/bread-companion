#!/usr/bin/env python3
"""
面包's red rotary phone — real geometry, built from scratch in Blender.

The product keeps the photographed plush (public/companion/bread-plush.webp);
only the phone on its table is 3D. The file keeps its name because the run
commands already point at it, but it models nothing except the phone.

Run on the Mac that has Blender (the script never shells out, never touches
the network, and only ever writes inside --output):

    blender --background --factory-startup \
        --python scripts/3d/build_companion.py -- --output public/companion/3d

What lands in --output:

    bread-phone.glb     the phone, self-contained — the only file the web loads
    bread-phone.blend   editable scene, every part a named object
    preview-34.png      EEVEE, three-quarter view from a little above
    preview-side.png    EEVEE, from the side — the depth is real
    model-stats.json    triangle counts, file sizes, arguments used

The shape, after seeing it on the real page (review/actual-*.png): the first
cut read as a red lunchbox with a carrying handle. A desk phone is recognised
by two things — a big round dial on a sloped face, and a heavy handset whose
two bell-shaped cups sit on the cradle like a pair of shoulders. So:

  * a low loaf of a body (it sits beside a bread, after all) whose front is
    one long slope carrying the dial, and whose ends round down into the base;
  * a dial on a real dial's layout — ten holes 28° apart starting at the upper
    right, the gap at the lower right where the brass finger stop stands, the
    numerals printed on the plate and seen through the holes;
  * a handset with weight: thick grip, bells nearly a quarter of the phone wide,
    resting in the cradle saddles, the grip low over the deck.

Conventions the web side relies on (components/phone3d/engine.ts):

  * Blender Z-up, the dial faces -Y. Exported +Y-up, so in three.js the phone
    stands on y = 0 and faces +Z. 1 unit = 1 metre; the phone is PHONE_W wide.
  * Node names (a missing optional node only costs that one movement):

        phone ── phone_body       lacquer shell, base, dial well, cradle saddles
                 plungers         two ivory buttons in the saddles; rise when lifted
                 dial_plate       ivory number plate with its numerals
                 dial_wheel       origin on the dial axis; spins about it
                 dial_axis        empty out along that axis
                 dial_cap         ivory centre dome
                 dial_stop        brass finger stop and the ring round the cap
                 deck_mark        empty on the deck under the handset (its shadow)
                 cord             the coiled cord at rest (the web draws its own)
                 cord_root        empty: where the cord leaves the body
                 handset ── handset_body, cord_tip (empty, under the mouthpiece)

    Every child is authored in its parent's space, so each node exports with a
    plain local transform and no parent-inverse matrix.

Only bpy, mathutils and the standard library. No modifiers, no randomness, and
no bpy.ops beyond save/render/export: the same arguments give the same file.
The numerals are Blender's own built-in font, baked to mesh at build time — no
font or texture travels with the GLB. Colour lives in a per-corner colour
attribute on the materials that use it.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

import bpy
from mathutils import Vector

# --------------------------------------------------------------------------
# palette — sRGB. A lacquer red that leans warm and a little brown, so it sits
# with the plush's crust colours instead of shouting over them; the ivory is
# the plush's own cream; the brass is quiet.
# --------------------------------------------------------------------------

LACQUER = "#a52a24"
LACQUER_HI = "#bf4438"
LACQUER_DEEP = "#5e1215"
BASE_RED = "#5f1715"
WELL = "#47100f"
IVORY = "#efe1c6"
IVORY_DEEP = "#c9b088"
NUMERAL = "#3a2418"
BRASS = "#b8925c"
CORD_COL = "#8a1d18"
EARPIECE = "#3e0c0f"
PAPER = "#f6f1e7"        # only the preview's ground and world use it

# --------------------------------------------------------------------------
# the lamp: warm, high on the left and in front — the light the plush was
# photographed in. engine.ts uses the same directions.
# --------------------------------------------------------------------------

KEY_POS = Vector((-0.55, -0.70, 0.75))
KEY_COL = "#ffe3bc"
FILL_POS = Vector((0.90, 0.25, 0.50))
FILL_COL = "#d8e4ff"
RIM_POS = Vector((0.20, 0.80, 0.62))
RIM_COL = "#ffd9a8"
AIM = Vector((0.0, 0.0, 0.035))

# --------------------------------------------------------------------------
# the phone, built at width 1.0 and scaled by PHONE_W
# --------------------------------------------------------------------------

PHONE_W = 0.125

#: side silhouette (depth, height), front to back: a long dial slope (points 2–4
#: are collinear, so the face stays flat), a short deck, a rounded back. Both
#: ends sit at PHONE_BOTTOM, buried inside the base.
PHONE_BOTTOM = 0.026
PHONE_SIDE = [
    (-0.428, PHONE_BOTTOM),
    (-0.442, 0.048),
    (-0.434, 0.070),
    (-0.2445, 0.205),
    (-0.055, 0.340),
    (0.030, 0.352),
    (0.115, 0.348),
    (0.230, 0.322),
    (0.330, 0.268),
    (0.395, 0.180),
    (0.420, 0.090),
    (0.410, PHONE_BOTTOM),
]
DECK_Z = 0.345
DIAL_C = (-0.2445, 0.205)     # the middle of the slope
DIAL_R = 0.202                # inside of the well; the bezel reaches 1.12 × this
WHEEL_R = 0.170               # the red finger wheel; a narrow ivory number ring shows outside it
WHEEL_INNER = 0.064
HOLE_R = 0.025
HOLE_AT = 0.125
NUMERAL_AT = 0.185            # printed on the visible ivory ring, clear of the wheel
CAP_R = 0.060
FIRST_HOLE = 40.0             # degrees, counter-clockwise from the right: "1" sits upper right
HOLE_STEP = 28.0              # …and "0" at 292°, leaving the gap for the finger stop

HORN_X = 0.355
HORN_Y = 0.045
HORN_BASE = 0.240             # deep enough to stay buried where the body's end domes down
HORN_RIM = 0.356
HORN_DISH = 0.338

HANDSET_Z = 0.470             # the handset's origin, with its bells resting on the horns
CUP_X = 0.355
CUP_TOP = 0.000               # bell top, at the handset origin
CORD_ROOT = Vector((0.290, 0.360, 0.110))
CORD_TIP = Vector((0.355, 0.000, -0.120))   # local to the handset, under the mouthpiece

# heights above the dial face, along its normal
PLATE_TOP = 0.006
WHEEL_TOP = 0.026
WHEEL_BOTTOM = 0.012
RIM_TOP = 0.040

# --------------------------------------------------------------------------
# small maths
# --------------------------------------------------------------------------


def clamp(x, lo=0.0, hi=1.0):
    return lo if x < lo else hi if x > hi else x


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0) if e1 != e0 else 0.0)
    return t * t * (3.0 - 2.0 * t)


def hexc(s):
    s = s.lstrip("#")
    return (int(s[0:2], 16) / 255.0, int(s[2:4], 16) / 255.0, int(s[4:6], 16) / 255.0)


def mix(a, b, t):
    return tuple(lerp(a[i], b[i], t) for i in range(3))


def shade(c, k):
    return tuple(clamp(v * k) for v in c)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear(hex_colour):
    return tuple(srgb_to_linear(c) for c in hexc(hex_colour))


def col(c):
    return hexc(c) if isinstance(c, str) else c


def basis(d):
    """Right-handed frame with e1 × e2 = d, so rings built on it wind outward."""
    d = d.normalized()
    a = Vector((0.0, 0.0, 1.0)) if abs(d.z) < 0.9 else Vector((1.0, 0.0, 0.0))
    e1 = a.cross(d).normalized()
    return e1, d.cross(e1)


def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2.0 * p1) + (p2 - p0) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
                  + (3.0 * p1 - p0 - 3.0 * p2 + p3) * t3)


def spline(points, per=20):
    pts = [points[0]] + list(points) + [points[-1]]
    out = []
    for i in range(len(pts) - 3):
        for s in range(per):
            out.append(catmull(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], s / per))
    out.append(points[-1].copy())
    return out


def resample(points, n, per=20):
    """`n` points spread evenly by arc length along a Catmull-Rom through `points`."""
    dense = spline(points, per)
    cum = [0.0]
    for a, b in zip(dense, dense[1:]):
        cum.append(cum[-1] + (b - a).length)
    total = cum[-1] or 1.0
    out, j = [], 0
    for i in range(n):
        d = total * i / (n - 1)
        while j < len(cum) - 2 and cum[j + 1] < d:
            j += 1
        span = cum[j + 1] - cum[j]
        out.append(dense[j].lerp(dense[j + 1], 0.0 if span <= 0 else (d - cum[j]) / span))
    return out


# --------------------------------------------------------------------------
# mesh building
#
# Patch by patch. Two patches meeting at a hard edge share no vertices — that
# is what gives the lacquer crisp edges with no modifier and no custom normals.
#
# Winding, verified once and relied on everywhere:
#   * rings are counter-clockwise seen from +axis;
#   * bridge(ring_at_-axis, ring_at_+axis) faces outward (a cylinder wall);
#   * bridge(outer, inner) faces +axis (an annulus);
#   * fan(tip, ring) faces +axis, cap(tip, ring) faces -axis, convex or dished.
# --------------------------------------------------------------------------


class Part:
    def __init__(self, name):
        self.name = name
        self.verts = []
        self.cols = []
        self.faces = []

    def v(self, p, c):
        self.verts.append((p.x, p.y, p.z))
        self.cols.append(col(c))
        return len(self.verts) - 1

    def ring(self, pts, cols):
        if not isinstance(cols, list):
            cols = [cols] * len(pts)
        return [self.v(p, c) for p, c in zip(pts, cols)]

    def face(self, *idx):
        self.faces.append(list(idx))

    def bridge(self, a, b, closed=True):
        n = len(a)
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            self.face(a[i], a[j], b[j], b[i])

    def fan(self, tip, ring, closed=True):
        n = len(ring)
        for i in range(n if closed else n - 1):
            self.face(tip, ring[i], ring[(i + 1) % n])

    def cap(self, tip, ring, closed=True):
        n = len(ring)
        for i in range(n if closed else n - 1):
            self.face(tip, ring[(i + 1) % n], ring[i])

    def circle(self, centre, e1, e2, radius, segs, c):
        pts = [centre + e1 * (math.cos(a) * radius) + e2 * (math.sin(a) * radius)
               for a in (2.0 * math.pi * i / segs for i in range(segs))]
        return self.ring(pts, c)

    def lathe(self, centre, axis, profile, segs):
        """
        Revolve [(radius, height, colour)] about `axis` through `centre`.

        Walk the profile so the solid stays on the walker's right: top faces
        outward, outer walls downward, undersides inward, inner walls upward.
        A radius of 0 closes that end on the axis.
        """
        axis = axis.normalized()
        e1, e2 = basis(axis)
        rings, tips = [], {}
        for i, (r, h, c) in enumerate(profile):
            at = centre + axis * h
            if r <= 1e-9:
                tips[i] = self.v(at, c)
                rings.append(None)
            else:
                rings.append(self.circle(at, e1, e2, r, segs, c))
        for i in range(len(profile) - 1):
            a, b = rings[i], rings[i + 1]
            if a is None and b is not None:
                self.fan(tips[i], b)
            elif a is not None and b is None:
                self.cap(tips[i + 1], a)
            elif a is not None and b is not None:
                self.bridge(b, a)
        return rings

    def tube(self, path, radii, segs, cols, cap_start=True, cap_end=True):
        """Sweep a round or elliptical section; the frame is carried, never spun."""
        n = len(path)
        dirs = []
        for i in range(n):
            d = path[min(n - 1, i + 1)] - path[max(0, i - 1)]
            dirs.append(d.normalized() if d.length > 1e-9 else Vector((0.0, 0.0, 1.0)))
        e1, e2 = basis(dirs[0])
        rings = []
        for i in range(n):
            if i:
                e1 = e1 - dirs[i] * e1.dot(dirs[i])
                e1 = e1.normalized() if e1.length > 1e-9 else basis(dirs[i])[0]
                e2 = dirs[i].cross(e1)
            r = radii[i]
            rx, ry = (r, r) if isinstance(r, (int, float)) else r
            pts = [path[i] + e1 * (math.cos(a) * rx) + e2 * (math.sin(a) * ry)
                   for a in (2.0 * math.pi * s / segs for s in range(segs))]
            rings.append(self.ring(pts, cols[i]))
        for i in range(n - 1):
            self.bridge(rings[i], rings[i + 1])
        if cap_start:
            self.cap(self.v(path[0], cols[0]), rings[0])
        if cap_end:
            self.fan(self.v(path[-1], cols[-1]), rings[-1])
        return rings

    def to_object(self, material, scene, name=None):
        name = name or self.name
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        me.validate(verbose=False)
        me.update()
        if me.polygons:
            me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
        me.materials.append(material)
        # Only meshes whose material reads the attribute get one: a COLOR_0 on a
        # flat-coloured material would multiply its colour in a second time.
        if material.get("bread_vertex_colour"):
            write_colours(me, self.cols)
        me.update()
        ob = bpy.data.objects.new(name, me)
        scene.collection.objects.link(ob)
        return ob


COLOUR_ATTR = "Col"
USE_BYTE_COLOURS = False


def write_colours(me, per_vertex):
    """One colour per corner, from the vertex under it. Float = linear, byte = sRGB."""
    kind = "BYTE_COLOR" if USE_BYTE_COLOURS else "FLOAT_COLOR"
    attr = me.color_attributes.new(name=COLOUR_ATTR, type=kind, domain="CORNER")
    flat = []
    for loop in me.loops:
        r, g, b = per_vertex[loop.vertex_index]
        if USE_BYTE_COLOURS:
            flat.extend((r, g, b, 1.0))
        else:
            flat.extend((srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0))
    attr.data.foreach_set("color_srgb" if USE_BYTE_COLOURS else "color", flat)
    me.color_attributes.active_color = attr


# --------------------------------------------------------------------------
# materials — warm lacquer, not hard plastic: broad soft highlights, thin coat
# --------------------------------------------------------------------------


def set_in(node, name, value):
    """Principled inputs have been renamed more than once; set what exists."""
    if name in node.inputs:
        node.inputs[name].default_value = value
        return True
    return False


def material(name, base, rough, metal=0.0, coat=0.0, coat_rough=0.25, vertex_colour=True):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat["bread_vertex_colour"] = vertex_colour
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    # With vertex colour the attribute *is* the colour, so the factor stays white.
    set_in(bsdf, "Base Color", (1.0, 1.0, 1.0, 1.0) if vertex_colour else (*linear(base), 1.0))
    set_in(bsdf, "Roughness", rough)
    set_in(bsdf, "Metallic", metal)
    set_in(bsdf, "IOR", 1.48)
    if coat:
        set_in(bsdf, "Coat Weight", coat)
        set_in(bsdf, "Coat Roughness", coat_rough)
    if vertex_colour:
        attr = nt.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = COLOUR_ATTR
        attr.location = (-320, 180)
        nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def build_materials():
    return {
        "lacquer": material("m_lacquer", LACQUER, 0.42, coat=0.3, coat_rough=0.28),
        "ivory": material("m_ivory", IVORY, 0.55, coat=0.1, coat_rough=0.4),
        "brass": material("m_brass", BRASS, 0.4, metal=0.8, vertex_colour=False),
        "cord": material("m_cord", CORD_COL, 0.46, coat=0.25, vertex_colour=False),
    }


# --------------------------------------------------------------------------
# the body
# --------------------------------------------------------------------------


def plan(x):
    """Half-depth factor across the width: a soft superellipse, square-ish to the ends."""
    k = clamp(abs(x) / 0.5, 0.0, 1.0)
    return max(0.0, 1.0 - k ** 5.5) ** (1.0 / 5.5)


def lacquer_colour(z_norm, k=1.0):
    """
    Flat lacquer with a little contact shade baked at the foot. Highlights and
    the shaded side are left to the actual lights.
    """
    c = mix(hexc(LACQUER_DEEP), hexc(LACQUER), smoothstep(0.03, 0.15, z_norm))
    return shade(c, k)


def build_phone_body(w):
    part = Part("phone_body")
    # back to front, so every cross-section winds the same way as the sweep
    side = resample([Vector((0.0, y, z)) for y, z in reversed(PHONE_SIDE)], 34)
    stations = 48
    rings = []
    for i in range(1, stations - 1):
        # clustered toward the ends, where the body rounds over fastest
        x = 0.5 * math.sin(math.pi * (i / (stations - 1) - 0.5))
        s = plan(x)
        pts, cols = [], []
        for p in side:
            # the ends dome down into the base, like the end of a loaf
            z = PHONE_BOTTOM + (p.z - PHONE_BOTTOM) * (s ** 0.62)
            pts.append(Vector((x, p.y * s, z)) * w)
            cols.append(lacquer_colour(z))
        rings.append(part.ring(pts, cols))
    for a, b in zip(rings, rings[1:]):
        part.bridge(a, b, closed=False)
    tip_col = lacquer_colour(0.04)
    part.cap(part.v(Vector((-0.5, 0.0, PHONE_BOTTOM)) * w, tip_col), rings[0], closed=False)
    part.fan(part.v(Vector((0.5, 0.0, PHONE_BOTTOM)) * w, tip_col), rings[-1], closed=False)

    build_base(part, w)
    build_well(part, w)
    for sx in (-1.0, 1.0):
        build_horn(part, w, sx)
    return part


def build_base(part, w):
    """A slim, darker plinth with a soft chamfer: a lip under the shell, never a tray."""
    rows = []
    for z, grow, k in ((0.000, 0.980, 0.58), (0.008, 0.996, 0.72), (0.024, 1.008, 0.90),
                       (0.034, 0.994, 1.00)):
        pts, cols = [], []
        for i in range(80):
            a = 2.0 * math.pi * i / 80
            cx, cy = math.cos(a), math.sin(a)
            scale = (abs(cx) ** 5 + abs(cy) ** 5) ** (-1.0 / 5.0)
            pts.append(Vector((cx * 0.506 * grow * scale, cy * 0.448 * grow * scale, z)) * w)
            cols.append(shade(hexc(BASE_RED), k))
        rows.append(part.ring(pts, cols))
    for a, b in zip(rows, rows[1:]):
        part.bridge(a, b)
    part.fan(part.v(Vector((0.0, 0.0, 0.034)) * w, shade(hexc(BASE_RED), 0.9)), rows[-1])
    part.cap(part.v(Vector((0.0, 0.0, 0.0)), shade(hexc(LACQUER_DEEP), 0.5)), rows[0])


def dial_frame(w):
    """Centre, outward normal and in-plane axes (e2 = up the slope) of the dial face."""
    a = Vector((0.0, PHONE_SIDE[2][0], PHONE_SIDE[2][1]))
    b = Vector((0.0, PHONE_SIDE[4][0], PHONE_SIDE[4][1]))
    along = (b - a).normalized()
    n = Vector((0.0, -along.z, along.y))       # the slope, turned 90° outward
    if n.y > 0.0:
        n = -n
    n = n.normalized()
    centre = Vector((0.0, DIAL_C[0], DIAL_C[1])) * w + n * (0.004 * w)
    e1 = Vector((1.0, 0.0, 0.0))
    return centre, n, e1, n.cross(e1).normalized()


def build_well(part, w):
    """
    The dial's well: a rounded lacquer bezel standing proud of the face, its
    inner wall in shade. Plate and wheel sit below its rim, so the dial reads as
    set into the phone from any angle — no boolean needed.
    """
    c, n, _e1, _e2 = dial_frame(w)
    r = DIAL_R * w
    part.lathe(c, n, [
        (r * 1.000, -0.006 * w, WELL),                         # inner wall, walked up
        (r * 1.000, (RIM_TOP - 0.012) * w, shade(hexc(LACQUER_DEEP), 1.2)),
        (r * 1.025, RIM_TOP * w, LACQUER),                     # over the rounded rim
        (r * 1.065, (RIM_TOP - 0.002) * w, LACQUER_HI),
        (r * 1.100, (RIM_TOP - 0.020) * w, LACQUER),
        (r * 1.120, -0.030 * w, LACQUER),                      # down into the face
    ], 80)


def build_horn(part, w, sx):
    """A small cradle post: a rounded shoulder rising from the deck, dished for a bell."""
    base = Vector((HORN_X * sx, HORN_Y, HORN_BASE)) * w
    rings = []
    for z, rx, ry in ((HORN_BASE, 0.070, 0.096), (HORN_RIM - 0.026, 0.062, 0.086),
                      (HORN_RIM - 0.008, 0.057, 0.080), (HORN_RIM, 0.052, 0.074)):
        pts = []
        for i in range(20):
            a = 2.0 * math.pi * i / 20
            cx, cy = math.cos(a), math.sin(a)
            scale = (abs(cx) ** 4 + abs(cy) ** 4) ** (-1.0 / 4.0)
            pts.append(Vector((base.x / w + cx * rx * scale, HORN_Y + cy * ry * scale, z)) * w)
        rings.append(part.ring(pts, lacquer_colour(z)))
    for a, b in zip(rings, rings[1:]):
        part.bridge(a, b)
    dish = Vector((HORN_X * sx, HORN_Y, HORN_DISH)) * w
    part.fan(part.v(dish, shade(hexc(LACQUER_DEEP), 1.15)), rings[-1])


def build_plungers(w):
    """Two ivory buttons inside the saddles, under the bells. Origin on the dish, so they rise."""
    part = Part("plungers")
    up = Vector((0.0, 0.0, 1.0))
    for sx in (-1.0, 1.0):
        c = Vector((HORN_X * sx, HORN_Y, 0.0)) * w
        part.lathe(c, up, [
            (0.0, 0.020 * w, IVORY),
            (0.022 * w, 0.018 * w, IVORY),
            (0.032 * w, 0.010 * w, IVORY),
            (0.034 * w, -0.012 * w, IVORY_DEEP),
        ], 16)
    return part


# --------------------------------------------------------------------------
# the dial
# --------------------------------------------------------------------------


def hole_angle(k):
    """Hole k (0 → "1", 9 → "0"), radians counter-clockwise from the dial's right."""
    return math.radians(FIRST_HOLE + HOLE_STEP * k)


def add_numeral(part, text, centre, e1, e2, normal, size):
    """
    Bake Blender's built-in font into the plate mesh. Kept upright, as on a real
    plate; no font or texture is needed at runtime.
    """
    curve = bpy.data.curves.new("dial_numeral_temp", type="FONT")
    curve.body = text
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.size = size
    curve.resolution_u = 4
    ob = bpy.data.objects.new("dial_numeral_temp", curve)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.update()
    evaluated = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        offset = len(part.verts)
        for vertex in mesh.vertices:
            p = vertex.co
            part.v(centre + e1 * p.x + e2 * p.y + normal * p.z, NUMERAL)
        for face in mesh.polygons:
            part.face(*(offset + i for i in face.vertices))
    finally:
        evaluated.to_mesh_clear()
        bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.curves.remove(curve)


def build_dial_plate(w):
    """A dark well floor so the finger holes read dark, with an ivory number ring on top."""
    part = Part("dial_plate")
    c, n, e1, e2 = dial_frame(w)
    r = DIAL_R * w
    # the well floor: deep, warm, so a hole in the wheel is a hole, not a white dot
    part.lathe(c, n, [
        (0.0, -0.010 * w, WELL),
        (r * 0.94, -0.010 * w, WELL),
        (r * 0.97, -0.008 * w, shade(hexc(WELL), 0.7)),
        (r, -0.030 * w, shade(hexc(WELL), 0.5)),
        (0.0, -0.030 * w, shade(hexc(WELL), 0.4)),
    ], 80)
    # the fixed ivory ring that carries the numbers; the wheel turns inside it
    ring_in = (WHEEL_R - 0.008) * w
    part.lathe(c, n, [
        (ring_in, PLATE_TOP * w, IVORY),
        (r * 0.90, PLATE_TOP * w, IVORY),
        (r * 0.955, (PLATE_TOP - 0.001) * w, IVORY_DEEP),
        (r * 0.985, (PLATE_TOP - 0.003) * w, IVORY),
        (r, (PLATE_TOP - 0.010) * w, IVORY_DEEP),
    ], 80)
    for k in range(10):
        a = hole_angle(k)
        at = c + (e1 * math.cos(a) + e2 * math.sin(a)) * (NUMERAL_AT * w)
        add_numeral(part, str((k + 1) % 10), at + n * ((PLATE_TOP + 0.0018) * w),
                    e1, e2, n, 0.026 * w)
    return part


def build_dial_wheel(w):
    """
    The red finger wheel, laid out like a real one: ten holes 28° apart and a
    solid stretch at the lower right for the finger stop.

    Each hole gets its own sector, a ring of quads bridging the sector outline
    to the hole; every hole point lies on the line from the hole's centre to its
    outline point, so the bridge never crosses itself. Top, underside and hole
    walls are separate patches (no shared vertices), so the flat top stays flat
    in the light and the walls stay round.
    """
    part = Part("dial_wheel")
    c, n, e1, e2 = dial_frame(w)
    r_out = WHEEL_R * w
    r_in = WHEEL_INNER * w
    hole = HOLE_R * w
    hole_at = HOLE_AT * w
    loops = 28
    half = math.radians(HOLE_STEP / 2.0)
    top_col = hexc(LACQUER)
    low_col = shade(hexc(LACQUER_DEEP), 0.9)
    wall_col = shade(hexc(LACQUER_DEEP), 1.15)

    def at(rad, ang, height):
        return (c + e1 * (math.cos(ang) * rad) + e2 * (math.sin(ang) * rad)
                + n * (height * w))

    for k in range(10):
        a0 = hole_angle(k)
        cx, cy = math.cos(a0) * hole_at, math.sin(a0) * hole_at
        inner, outer = [], []
        for i in range(loops):
            edge = 4.0 * i / loops
            # the sector outline, walked counter-clockwise like the hole
            if edge < 1.0:
                rad, ang = r_out, a0 - half + 2.0 * half * edge
            elif edge < 2.0:
                rad, ang = lerp(r_out, r_in, edge - 1.0), a0 + half
            elif edge < 3.0:
                rad, ang = r_in, a0 + half - 2.0 * half * (edge - 2.0)
            else:
                rad, ang = lerp(r_in, r_out, edge - 3.0), a0 - half
            ox, oy = math.cos(ang) * rad, math.sin(ang) * rad
            d = Vector((ox - cx, oy - cy, 0.0)).normalized()
            hx, hy = cx + d.x * hole, cy + d.y * hole
            inner.append((math.hypot(hx, hy), math.atan2(hy, hx)))
            outer.append((rad, ang))
        it = part.ring([at(r, a, WHEEL_TOP) for r, a in inner], top_col)
        ot = part.ring([at(r, a, WHEEL_TOP) for r, a in outer], top_col)
        ib = part.ring([at(r, a, WHEEL_BOTTOM) for r, a in inner], low_col)
        ob = part.ring([at(r, a, WHEEL_BOTTOM) for r, a in outer], low_col)
        part.bridge(ot, it)      # top face of the sector
        part.bridge(ib, ob)      # its underside
        wt = part.ring([at(r, a, WHEEL_TOP) for r, a in inner], wall_col)
        wb = part.ring([at(r, a, WHEEL_BOTTOM) for r, a in inner], low_col)
        part.bridge(wt, wb)      # the finger hole's wall, facing inward

    # the solid stretch between "0" and "1", where the finger stop stands
    g0 = hole_angle(9) + half
    g1 = hole_angle(0) - half + 2.0 * math.pi
    steps = 16
    arc = [lerp(g0, g1, i / steps) for i in range(steps + 1)]
    ot = part.ring([at(r_out, a, WHEEL_TOP) for a in arc], top_col)
    it = part.ring([at(r_in, a, WHEEL_TOP) for a in arc], top_col)
    ob = part.ring([at(r_out, a, WHEEL_BOTTOM) for a in arc], low_col)
    ib = part.ring([at(r_in, a, WHEEL_BOTTOM) for a in arc], low_col)
    part.bridge(ot, it, closed=False)
    part.bridge(ib, ob, closed=False)

    for rad, outer_rim in ((r_out, True), (r_in, False)):
        top = [at(rad, 2.0 * math.pi * i / 140, WHEEL_TOP) for i in range(140)]
        bot = [at(rad, 2.0 * math.pi * i / 140, WHEEL_BOTTOM) for i in range(140)]
        rt = part.ring(top, top_col)
        rb = part.ring(bot, low_col)
        if outer_rim:
            part.bridge(rb, rt)
        else:
            part.bridge(rt, rb)
    return part


def build_dial_cap(w):
    part = Part("dial_cap")
    c, n, _e1, _e2 = dial_frame(w)
    r = CAP_R * w
    part.lathe(c, n, [
        (0.0, 0.052 * w, "#fffaf0"),
        (r * 0.44, 0.051 * w, IVORY),
        (r * 0.78, 0.046 * w, IVORY),
        (r * 0.96, 0.039 * w, IVORY),
        (r, 0.034 * w, IVORY_DEEP),
        (r, WHEEL_BOTTOM * w, shade(hexc(IVORY_DEEP), 0.6)),
        (0.0, WHEEL_BOTTOM * w, shade(hexc(IVORY_DEEP), 0.4)),
    ], 36)
    return part


def build_dial_stop(w):
    """The brass finger stop — fixed to the body, standing in the wheel's gap — and a ring round the cap."""
    part = Part("dial_stop")
    c, n, e1, e2 = dial_frame(w)
    stop = math.radians(-26.0)
    pts = []
    for f in range(7):
        g = f / 6.0
        a = stop + math.radians(8.0) * g
        rad = (WHEEL_R - 0.012 + 0.050 * g ** 1.2) * w
        pts.append(c + e1 * (math.cos(a) * rad) + e2 * (math.sin(a) * rad)
                   + n * ((WHEEL_TOP + 0.010 + 0.010 * g) * w))
    path = resample(pts, 9)
    gold = hexc(BRASS)
    part.tube(path, [0.016 * w * (1.0 - 0.3 * i / 8) for i in range(9)], 8, [gold] * 9)
    r = CAP_R * w
    part.lathe(c, n, [
        (r * 1.00, WHEEL_TOP * w, gold),                # inner wall, walked up
        (r * 1.00, 0.037 * w, gold),
        (r * 1.05, 0.040 * w, gold),
        (r * 1.10, 0.037 * w, gold),
        (r * 1.10, WHEEL_TOP * w, gold),
    ], 36)
    return part


# --------------------------------------------------------------------------
# the handset
# --------------------------------------------------------------------------

#: the grip: (x, z, rx, ry); rx is its depth, ry its height. Low and nearly
#: straight, swelling into the bells, so the handset reads as one heavy piece.
HANDSET_GRIP = [
    (-0.345, 0.004, 0.064, 0.052),     # ends sunk into the bells
    (-0.320, 0.010, 0.062, 0.052),
    (-0.270, 0.016, 0.058, 0.050),
    (-0.160, 0.022, 0.055, 0.048),
    (-0.050, 0.025, 0.054, 0.047),
    (0.050, 0.025, 0.054, 0.047),
    (0.160, 0.022, 0.055, 0.048),
    (0.270, 0.016, 0.058, 0.050),
    (0.320, 0.010, 0.062, 0.052),
    (0.345, 0.004, 0.064, 0.052),
]

#: one bell, (radius, height below CUP_TOP, colour): a broad shoulder, a rim,
#: and a dark dished grille with two quiet rings in it.
BELL = [
    (0.000, 0.000, LACQUER),
    (0.100, 0.000, LACQUER),      # a flat top, so the cup reads as a cup and not a ball
    (0.124, -0.006, LACQUER),
    (0.132, -0.020, LACQUER),
    (0.133, -0.090, LACQUER),
    (0.126, -0.111, "rim"),
    (0.104, -0.122, "rim-in"),
    (0.084, -0.116, EARPIECE),
    (0.062, -0.114, "grille"),
    (0.042, -0.113, EARPIECE),
    (0.022, -0.112, "grille"),
    (0.000, -0.111, EARPIECE),
]


def build_handset(w):
    """
    Built around its own origin so the browser can carry it to 面包's cheek: a
    thick grip and, at each end, a bell that opens downward onto a dark grille.
    """
    part = Part("handset_body")
    path = [Vector((x, 0.0, z)) * w for x, z, _rx, _ry in HANDSET_GRIP]
    radii = [(rx * w, ry * w) for _x, _z, rx, ry in HANDSET_GRIP]
    part.tube(path, radii, 18, [lacquer_colour(0.3)] * len(path))

    tone = {
        "rim": shade(hexc(LACQUER), 0.92),
        "rim-in": shade(hexc(LACQUER_DEEP), 1.1),
        "grille": shade(hexc(EARPIECE), 1.45),
    }
    up = Vector((0.0, 0.0, 1.0))
    for sx in (-1.0, 1.0):
        top = Vector((CUP_X * sx, 0.0, CUP_TOP)) * w
        part.lathe(top, up, [(r * w, h * w, tone.get(c, c)) for r, h, c in BELL], 32)
    return part


def build_cord(w, a, b):
    """
    The coiled cord at rest, as real tube geometry, so the .blend, the preview
    and any glTF viewer show a whole phone. The browser draws its own.
    """
    part = Part("cord")
    turns, per = 16, 10
    n = turns * per
    mid = (a + b) * 0.5 + Vector((0.10, 0.04, -0.14)) * w
    e1, e2 = basis((b - a).normalized())
    pts = []
    for i in range(n + 1):
        t = i / n
        base = a * (1 - t) ** 2 + mid * (2 * (1 - t) * t) + b * (t * t)
        ang = 2.0 * math.pi * turns * t
        rad = 0.044 * w * min(1.0, t * 9.0, (1.0 - t) * 9.0)
        pts.append(base + e1 * (math.cos(ang) * rad) + e2 * (math.sin(ang) * rad))
    part.tube(pts, [0.016 * w] * len(pts), 6, [hexc(CORD_COL)] * len(pts))
    return part


# --------------------------------------------------------------------------
# scene assembly
# --------------------------------------------------------------------------


def empty(scene, name, location, parent=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 0.01
    ob.location = location
    scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def build_scene():
    """Everything authored in its parent's space, so parenting is a plain assignment."""
    scene = bpy.context.scene
    mats = build_materials()
    w = PHONE_W
    made = {}

    phone = empty(scene, "phone", Vector((0.0, 0.0, 0.0)))
    made["phone_body"] = build_phone_body(w).to_object(mats["lacquer"], scene)
    made["dial_plate"] = build_dial_plate(w).to_object(mats["ivory"], scene)
    made["dial_cap"] = build_dial_cap(w).to_object(mats["ivory"], scene)
    made["dial_stop"] = build_dial_stop(w).to_object(mats["brass"], scene)

    # the wheel turns about the dial's own axis, so its origin goes there
    centre, normal, _e1, _e2 = dial_frame(w)
    wheel = build_dial_wheel(w).to_object(mats["lacquer"], scene)
    for vert in wheel.data.vertices:
        vert.co = vert.co - centre
    wheel.location = centre
    made["dial_wheel"] = wheel
    empty(scene, "dial_axis", centre + normal * (0.4 * w), phone)

    plungers = build_plungers(w).to_object(mats["ivory"], scene)
    plungers.location = Vector((0.0, 0.0, HORN_DISH)) * w
    made["plungers"] = plungers

    empty(scene, "deck_mark", Vector((0.0, HORN_Y, DECK_Z + 0.004)) * w, phone)

    rest = Vector((0.0, HORN_Y, HANDSET_Z)) * w
    handset = empty(scene, "handset", rest, phone)
    hs = build_handset(w).to_object(mats["lacquer"], scene, "handset_body")
    hs.parent = handset
    made["handset_body"] = hs
    empty(scene, "cord_tip", CORD_TIP * w, handset)
    empty(scene, "cord_root", CORD_ROOT * w, phone)
    made["cord"] = build_cord(w, CORD_ROOT * w, rest + CORD_TIP * w).to_object(
        mats["cord"], scene)

    for key in ("phone_body", "dial_plate", "dial_wheel", "dial_cap", "dial_stop",
                "plungers", "cord"):
        made[key].parent = phone

    bpy.context.view_layer.update()
    return scene, phone, made


# --------------------------------------------------------------------------
# lights, camera, preview
# --------------------------------------------------------------------------


def add_light(scene, name, kind, location, colour, power, size=0.6):
    data = bpy.data.lights.new(name, type=kind)
    data.color = hexc(colour)
    data.energy = power
    if kind == "AREA":
        data.shape = "DISK"
        data.size = size
    ob = bpy.data.objects.new(name, data)
    ob.location = location
    scene.collection.objects.link(ob)
    ob.rotation_euler = (AIM - location).to_track_quat("-Z", "Y").to_euler()
    return ob


def setup_light_rig(scene, exposure):
    """A big soft key, so the lacquer gets broad, quiet highlights instead of hot spots."""
    add_light(scene, "key", "AREA", KEY_POS, KEY_COL, 20.0 * exposure, 1.2)
    add_light(scene, "fill", "AREA", FILL_POS, FILL_COL, 5.0 * exposure, 1.4)
    add_light(scene, "rim", "AREA", RIM_POS, RIM_COL, 10.0 * exposure, 0.9)
    world = bpy.data.worlds.new("bread_world")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (*linear(PAPER), 1.0)
        bg.inputs[1].default_value = 0.32 * exposure
    scene.world = world


def add_ground(scene):
    """Only for the preview — never part of the export."""
    part = Part("preview_ground")
    rings = []
    for rad in (0.001, 0.12, 0.4, 1.4):
        pts = [Vector((math.cos(a) * rad, math.sin(a) * rad, 0.0))
               for a in (2.0 * math.pi * i / 48 for i in range(48))]
        rings.append(part.ring(pts, mix(hexc("#e8dcc6"), hexc(PAPER), clamp(rad / 1.2))))
    part.fan(part.v(Vector((0.0, 0.0, 0.0)), "#e8dcc6"), rings[0])
    for a, b in zip(rings, rings[1:]):
        part.bridge(a, b)
    return part.to_object(material("m_ground", PAPER, 0.95), scene)


def place_camera(scene, azimuth_deg, elevation_deg, distance, target, lens=85.0):
    cam = bpy.data.objects.get("preview_cam")
    if cam is None:
        data = bpy.data.cameras.new("preview_cam")
        data.lens = lens
        cam = bpy.data.objects.new("preview_cam", data)
        scene.collection.objects.link(cam)
    az, el = math.radians(azimuth_deg), math.radians(elevation_deg)
    cam.location = target + Vector((
        math.sin(az) * math.cos(el) * distance,
        -math.cos(az) * math.cos(el) * distance,
        math.sin(el) * distance,
    ))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam


def pick_engine(scene):
    items = {e.identifier for e in
             bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    for name in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        if name in items:
            return name
    return scene.render.engine


def render_preview(scene, path, size, azimuth, elevation, distance, target, samples):
    scene.render.engine = pick_engine(scene)
    eevee = getattr(scene, "eevee", None)
    if eevee is not None and hasattr(eevee, "taa_render_samples"):
        eevee.taa_render_samples = samples
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    try:
        scene.view_settings.view_transform = "AgX"    # what the Mac run was judged in
    except TypeError:
        pass
    place_camera(scene, azimuth, elevation, distance, target)
    bpy.ops.render.render(write_still=True)


# --------------------------------------------------------------------------
# export
# --------------------------------------------------------------------------


def op_kwargs(op, **kw):
    """Pass only the options this Blender's exporter actually has."""
    props = op.get_rna_type().properties.keys()
    return {k: v for k, v in kw.items() if k in props}


def subtree(root):
    out = [root]
    for child in root.children:
        out.extend(subtree(child))
    return out


def export_glb(path, root):
    objects = subtree(root)
    for ob in bpy.context.scene.objects:
        ob.select_set(False)
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = root
    op = bpy.ops.export_scene.gltf
    op(**op_kwargs(
        op,
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=False,
        export_normals=True,
        export_tangents=False,
        export_vertex_color="ACTIVE",       # one COLOR_0, never a stray COLOR_1
        export_all_vertex_colors=False,
        export_skins=False,
        export_morph=False,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_draco_mesh_compression_enable=False,
    ))
    for ob in objects:
        ob.select_set(False)


def object_stats(objects):
    stats = {}
    for ob in objects:
        if ob.type != "MESH":
            continue
        me = ob.data
        stats[ob.name] = {
            "vertices": len(me.vertices),
            "triangles": sum(len(p.vertices) - 2 for p in me.polygons),
            "material": me.materials[0].name if me.materials else None,
            "colour_attribute": bool(me.color_attributes),
        }
    return stats


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def parse_args(argv):
    p = argparse.ArgumentParser(
        prog="build_companion.py",
        description="Model 面包's red rotary phone; export GLB + EEVEE preview.")
    p.add_argument("--output", required=True,
                   help="directory for every artefact; nothing is written outside it")
    p.add_argument("--preview", default="34,side",
                   help="comma-separated preview views: 34, front, side, none")
    p.add_argument("--preview-size", type=int, default=768)
    p.add_argument("--samples", type=int, default=64, help="EEVEE samples per preview")
    p.add_argument("--exposure", type=float, default=1.0, help="scale the whole light rig")
    p.add_argument("--byte-colors", action="store_true",
                   help="store vertex colour as sRGB bytes instead of linear floats")
    p.add_argument("--no-blend", action="store_true")
    return p.parse_args(argv)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parse_args(argv)

    global USE_BYTE_COLOURS
    USE_BYTE_COLOURS = args.byte_colors

    out = os.path.abspath(os.path.expanduser(args.output))
    os.makedirs(out, exist_ok=True)

    started = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    paths = bpy.context.preferences.filepaths
    if hasattr(paths, "save_version"):
        paths.save_version = 0                # no .blend1 next to the artefacts on reruns
    scene, phone, made = build_scene()
    built = time.time()

    report = {
        "generated_by": "scripts/3d/build_companion.py",
        "blender": bpy.app.version_string,
        "arguments": vars(args),
        "units": "metre; Blender Z-up, exported +Y-up (the dial faces +Z in three.js)",
        "phone_width_m": PHONE_W,
        "colour_attribute": {
            "name": COLOUR_ATTR,
            "type": "BYTE_COLOR" if USE_BYTE_COLOURS else "FLOAT_COLOR",
            "domain": "CORNER",
        },
        "objects": object_stats(made.values()),
        "files": {},
    }
    report["totals"] = {
        "triangles": sum(o["triangles"] for o in report["objects"].values()),
        "vertices": sum(o["vertices"] for o in report["objects"].values()),
        "objects": len(report["objects"]),
    }

    glb = os.path.join(out, "bread-phone.glb")
    export_glb(glb, phone)
    if os.path.exists(glb):
        report["files"]["bread-phone.glb"] = os.path.getsize(glb)
    exported = time.time()

    setup_light_rig(scene, args.exposure)
    add_ground(scene)
    views = {
        "34": ("preview-34.png", -30.0, 20.0, 0.66),
        "front": ("preview-front.png", 0.0, 16.0, 0.62),
        "side": ("preview-side.png", -88.0, 10.0, 0.62),
    }
    target = Vector((0.0, 0.0, 0.036))
    for key in [v.strip() for v in args.preview.split(",") if v.strip()]:
        if key not in views:
            continue
        name, az, el, dist = views[key]
        path = os.path.join(out, name)
        render_preview(scene, path, args.preview_size, az, el, dist, target, args.samples)
        if os.path.exists(path):
            report["files"][name] = os.path.getsize(path)
    rendered = time.time()

    if not args.no_blend:
        blend = os.path.join(out, "bread-phone.blend")
        bpy.ops.wm.save_as_mainfile(filepath=blend)
        report["files"]["bread-phone.blend"] = os.path.getsize(blend)

    report["seconds"] = {
        "model": round(built - started, 2),
        "export": round(exported - built, 2),
        "render": round(rendered - exported, 2),
        "total": round(time.time() - started, 2),
    }
    with open(os.path.join(out, "model-stats.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2, ensure_ascii=False)

    print(f"[bread] {report['totals']['triangles']} triangles in "
          f"{report['totals']['objects']} objects → {out}")
    for name, size in report["files"].items():
        print(f"[bread]   {name}: {size} bytes")


if __name__ == "__main__":
    main()
