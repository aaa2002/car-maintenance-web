"""Generate every Vehix logo variant as standalone SVG from one set of geometry.

Usage (from the repo root, with fonttools installed: pip install fonttools):
    python3 brand/source/generate.py brand/svg
    node brand/source/export.mjs
The second step renders brand/png, brand/vehix-favicon.ico and the icons the app serves.
After changing geometry, also regenerate src/components/brand-logo.tsx from geometry.json.
"""
import json, os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

# ---- Palette (royal blue, matches src/theme/tokens.css) ----
INK = '#0F1729'          # wordmark on light
INK_TAG = '#4B5568'      # tagline on light
PAPER = '#F5F7FB'        # wordmark on dark
PAPER_TAG = '#AEB6C8'    # tagline on dark
BRAND = '#1F55D6'        # royal blue
DOT = '#3B74F0'          # i-dot / wedge (slightly lighter than BRAND so it reads at small sizes)
NAVY = '#0B1630'         # dark tiles and dark backgrounds
GRAD = {  # left blade: bright to deep royal; right blade: lighter royal
    'left': ('#5B8FFF', '#1846C8'),
    'right': ('#8FB4FF', '#3A6CEC'),
}

# ---- Mark geometry, traced from the concept (units = 840px-wide zoom of the concept) ----
LEFT = ('M48 125 L205 125 C255 125 290 145 315 185 L470 440 Q482 462 512 467 '
        'C492 520 445 578 375 580 C310 582 265 550 238 500 L36 145 C30 133 36 125 48 125 Z')
RIGHT = ('M590 35 L755 35 C768 35 774 47 767 58 L553 402 C545 416 528 424 512 410 '
         'L404 240 C397 228 398 216 405 206 L520 68 C538 47 560 35 590 35 Z')
# Lighter facet over each blade, clipped to the blade.
LEFT_FACET = 'M0 0 L170 0 L170 125 L415 600 L0 600 Z'
RIGHT_FACET = 'M610 0 L840 0 L840 600 L520 600 Z'
MARK_BOX = (30, 33, 746, 551)  # x, y, w, h of the mark in its own units


def mark_group(uid, mode='gradient', color=None):
    """mode: gradient | flat (single colour) """
    x, y, w, h = MARK_BOX
    if mode == 'flat':
        return (f'<g transform="translate({-x} {-y})"><path d="{LEFT}" fill="{color}"/>'
                f'<path d="{RIGHT}" fill="{color}"/></g>')
    defs = (f'<defs>'
            f'<linearGradient id="{uid}l" x1="60" y1="120" x2="470" y2="590" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{GRAD["left"][0]}"/><stop offset="1" stop-color="{GRAD["left"][1]}"/></linearGradient>'
            f'<linearGradient id="{uid}r" x1="770" y1="30" x2="430" y2="420" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{GRAD["right"][0]}"/><stop offset="1" stop-color="{GRAD["right"][1]}"/></linearGradient>'
            f'<clipPath id="{uid}cl"><path d="{LEFT}"/></clipPath><clipPath id="{uid}cr"><path d="{RIGHT}"/></clipPath>'
            f'</defs>')
    return (defs + f'<g transform="translate({-x} {-y})">'
            f'<path d="{LEFT}" fill="url(#{uid}l)"/><path d="{LEFT_FACET}" fill="#fff" opacity=".13" clip-path="url(#{uid}cl)"/>'
            f'<path d="{RIGHT}" fill="url(#{uid}r)"/><path d="{RIGHT_FACET}" fill="#fff" opacity=".12" clip-path="url(#{uid}cr)"/>'
            f'</g>')


# ---- Type ----
bold = TTFont(os.path.join(os.path.dirname(__file__), 'Poppins-Bold.ttf'))
regular = TTFont(os.path.join(os.path.dirname(__file__), 'Poppins-Regular.ttf'))


def glyph_path(font, ch, dx, scale=1.0, baseline=0.0):
    gs = font.getGlyphSet(); name = font.getBestCmap()[ord(ch)]
    pen = SVGPathPen(gs)
    gs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, dx, baseline)))
    return pen.getCommands(), font['hmtx'][name][0] * scale


def wordmark():
    """'vehix' in Poppins Bold, baseline y=0, x from 0; returns (ink path, i-stem box, width)."""
    tracking = -14
    d, x = [], 0.0
    stem = None
    for ch in 'vehıx':
        cmd, adv = glyph_path(bold, ch, x)
        d.append(cmd)
        if ch == 'ı':
            b = BoundsPen(bold.getGlyphSet()); bold.getGlyphSet()['dotlessi'].draw(b)
            stem = (x + b.bounds[0], x + b.bounds[2], b.bounds[3])
        x += adv + tracking
    # trim right side bearing of x
    b = BoundsPen(bold.getGlyphSet()); bold.getGlyphSet()['x'].draw(b)
    width = x - tracking - (bold['hmtx']['x'][0] - b.bounds[2])
    return ' '.join(d), stem, width


WORD, STEM, WORD_W = wordmark()
WORD_LEFT = 62  # left bearing of 'v'... measured below and subtracted
_b = BoundsPen(bold.getGlyphSet()); bold.getGlyphSet()['v'].draw(_b); WORD_LEFT = _b.bounds[0]
ASC = 740  # top of 'h'


def accents(color):
    """Blue i-dot and the blue wedge cut into the top of the i stem."""
    x0, x1, top = STEM
    r = 96
    cx = (x0 + x1) / 2 + 18
    wedge = f'<path d="M{x0:.1f} {-top:.1f} L{x1:.1f} {-top:.1f} L{x1:.1f} {-top + 150:.1f} Z" fill="{color}"/>'
    dot = f'<circle cx="{cx:.1f}" cy="{-(top + 80 + r):.1f}" r="{r}" fill="{color}"/>'
    return wedge + dot, -(top + 80 + 2 * r)


def tagline(width, color, cap=128):
    """FLEET MANAGEMENT tracked out to exactly `width`, cap height `cap`, baseline y=0."""
    text = 'FLEET MANAGEMENT'
    scale = cap / regular['OS/2'].sCapHeight
    gs = regular.getGlyphSet(); cmap = regular.getBestCmap()
    advs = [regular['hmtx'][cmap[ord(c)]][0] * scale for c in text]
    first = BoundsPen(gs); gs[cmap[ord(text[0])]].draw(first)
    last = BoundsPen(gs); gs[cmap[ord(text[-1])]].draw(last)
    ink = sum(advs[:-1]) - first.bounds[0] * scale + last.bounds[2] * scale
    track = (width - ink) / (len(text) - 1)
    x = -first.bounds[0] * scale
    d = []
    for c, adv in zip(text, advs):
        if c != ' ':
            cmd, _ = glyph_path(regular, c, x, scale)
            d.append(cmd)
        x += adv + track
    return f'<path d="{" ".join(d)}" fill="{color}"/>'


def word_group(ink, accent, with_tag, tag_color, tag_gap=200):
    acc, top = accents(accent)
    g = f'<g transform="translate({-WORD_LEFT:.1f} 0)"><path d="{WORD}" fill="{ink}"/>{acc}</g>'
    bottom = 0
    if with_tag:
        cap = 128
        g += f'<g transform="translate(0 {tag_gap + cap})">{tagline(WORD_W - WORD_LEFT, tag_color, cap)}</g>'
        bottom = tag_gap + cap
    return g, top, bottom


def svg(w, h, body, bg=None, title='Vehix'):
    rect = f'<rect width="{w:.0f}" height="{h:.0f}" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{rect}{body}</svg>\n')


def write(name, content):
    with open(os.path.join(OUT, name + '.svg'), 'w') as f:
        f.write(content)


MW, MH = MARK_BOX[2], MARK_BOX[3]
TEXT_W = WORD_W - WORD_LEFT


def horizontal(theme, tag, mode='gradient'):
    ink, tag_c, accent = (INK, INK_TAG, DOT) if theme == 'light' else (PAPER, PAPER_TAG, DOT)
    mark_color = None
    if mode == 'mono-black': ink = tag_c = accent = mark_color = INK
    if mode == 'mono-white': ink = tag_c = accent = mark_color = '#FFFFFF'
    if mode == 'single': ink = tag_c = accent = mark_color = BRAND
    words, top, bottom = word_group(ink, accent, tag, tag_c)
    # Mark height relative to the wordmark, taken from the concept.
    mh = (bottom - top + 330) if tag else (ASC * 1.62)
    s = mh / MH
    gap = 110
    mark_y = top - 40 if tag else -ASC - (mh - ASC) * 0.6
    mark = (f'<g transform="translate(0 {mark_y:.1f}) scale({s:.4f})">'
            + mark_group(f'vx{theme[0]}{int(tag)}', 'flat' if mark_color else 'gradient', mark_color) + '</g>')
    text_x = MW * s + gap
    y0 = min(top, mark_y)
    y1 = max(bottom + (40 if tag else 0), mark_y + mh)
    pad = 0
    w = text_x + TEXT_W
    body = f'<g transform="translate(0 {-y0:.1f})">{mark}<g transform="translate({text_x:.1f} 0)">{words}</g></g>'
    return svg(w, y1 - y0, body)


def stacked(theme, tag):
    ink, tag_c = (INK, INK_TAG) if theme == 'light' else (PAPER, PAPER_TAG)
    words, top, bottom = word_group(ink, DOT, tag, tag_c)
    mw = TEXT_W * 0.78
    s = mw / MW; mh = MH * s
    gap = 150
    text_top = top
    mark_x = (TEXT_W - mw) / 2
    mark = f'<g transform="translate({mark_x:.1f} 0) scale({s:.4f})">' + mark_group(f'vxs{theme[0]}{int(tag)}') + '</g>'
    words_y = mh + gap - text_top
    h = words_y + bottom + (20 if tag else 0)
    body = mark + f'<g transform="translate(0 {words_y:.1f})">{words}</g>'
    return svg(TEXT_W, h, body)


def wordmark_svg(theme):
    ink = INK if theme == 'light' else PAPER
    words, top, bottom = word_group(ink, DOT, False, None)
    return svg(TEXT_W, -top, f'<g transform="translate(0 {-top:.1f})">{words}</g>')


def mark_svg(mode='gradient', color=None, uid='vxm'):
    return svg(MW, MH, mark_group(uid, mode, color))


def tile(size, bg, mark_mode, mark_color=None, radius=0.2237, inset=0.17, uid='vxt', border=None, full_bleed=False):
    """Square app icon: rounded tile (or full bleed) with the mark centred."""
    if isinstance(bg, tuple):
        defs = (f'<defs><linearGradient id="{uid}bg" x1="0" y1="0" x2="{size}" y2="{size}" gradientUnits="userSpaceOnUse">'
                f'<stop offset="0" stop-color="{bg[0]}"/><stop offset="1" stop-color="{bg[1]}"/></linearGradient></defs>')
        fill = f'url(#{uid}bg)'
    else:
        defs, fill = '', bg
    r = 0 if full_bleed else size * radius
    stroke = f' stroke="{border}" stroke-width="{size * 0.006:.1f}"' if border else ''
    shape = f'<rect x="0" y="0" width="{size}" height="{size}" rx="{r:.1f}" fill="{fill}"{stroke}/>'
    avail = size * (1 - 2 * inset)
    s = avail / MW
    mh = MH * s
    # optical centring: the V's mass sits low, so nudge it up a little
    tx, ty = size * inset, (size - mh) / 2 - size * 0.015
    mark = f'<g transform="translate({tx:.1f} {ty:.1f}) scale({s:.4f})">' + mark_group(uid + 'm', mark_mode, mark_color) + '</g>'
    return svg(size, size, defs + shape + mark)


variants = {
    # lockups
    'vehix-logo-horizontal': horizontal('light', True),
    'vehix-logo-horizontal-dark': horizontal('dark', True),
    'vehix-logo-horizontal-notagline': horizontal('light', False),
    'vehix-logo-horizontal-notagline-dark': horizontal('dark', False),
    'vehix-logo-stacked': stacked('light', True),
    'vehix-logo-stacked-dark': stacked('dark', True),
    'vehix-logo-stacked-notagline': stacked('light', False),
    'vehix-logo-stacked-notagline-dark': stacked('dark', False),
    'vehix-logo-mono-black': horizontal('light', True, 'mono-black'),
    'vehix-logo-mono-white': horizontal('dark', True, 'mono-white'),
    'vehix-logo-single-color': horizontal('light', True, 'single'),
    'vehix-wordmark': wordmark_svg('light'),
    'vehix-wordmark-light': wordmark_svg('dark'),
    # mark
    'vehix-mark': mark_svg(),
    'vehix-mark-black': mark_svg('flat', INK, 'vxk'),
    'vehix-mark-white': mark_svg('flat', '#FFFFFF', 'vxw'),
    # app icons (1024 master, rounded tile)
    'vehix-app-icon-blue': tile(1024, ('#3F78F2', '#1846C8'), 'flat', '#FFFFFF', uid='vxa1'),
    'vehix-app-icon-dark': tile(1024, NAVY, 'gradient', uid='vxa2'),
    'vehix-app-icon-gradient': tile(1024, ('#8DB6FF', '#1F55D6'), 'flat', '#FFFFFF', uid='vxa3'),
    'vehix-app-icon-mono': tile(1024, '#F3F5F9', 'flat', INK, uid='vxa4', border='#E1E6EF'),
    'vehix-favicon': tile(256, '#FFFFFF', 'gradient', uid='vxf', inset=0.16, border='#E1E6EF'),
    # tighter padding so the V stays legible at 16-48px (browser tabs, favicon.ico)
    'vehix-favicon-small': tile(64, '#FFFFFF', 'gradient', uid='vxfs', inset=0.09, radius=0.2, border='#E1E6EF'),
    # platform-specific: full bleed for iOS (it rounds corners itself), safe-zone padding for Android maskable
    'vehix-apple-touch-icon': tile(1024, ('#3F78F2', '#1846C8'), 'flat', '#FFFFFF', uid='vxap', full_bleed=True),
    'vehix-maskable-icon': tile(1024, ('#3F78F2', '#1846C8'), 'flat', '#FFFFFF', uid='vxmk', full_bleed=True, inset=0.27),
}
for name, content in variants.items():
    write(name, content)

# Raw geometry for the in-app React component.
acc_light, acc_top = accents('DOT')
json.dump({
    'markBox': MARK_BOX, 'left': LEFT, 'right': RIGHT, 'leftFacet': LEFT_FACET, 'rightFacet': RIGHT_FACET,
    'grad': GRAD, 'word': WORD, 'wordLeft': WORD_LEFT, 'wordWidth': TEXT_W, 'stem': STEM, 'asc': ASC, 'dotColor': DOT,
}, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'geometry.json'), 'w'))
print('wrote', len(variants), 'svgs; wordmark width', round(TEXT_W), 'mark', MW, 'x', MH)
