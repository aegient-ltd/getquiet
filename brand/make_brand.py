"""Interim Quiet Protect social images (getquiet/brand), built from the getquiet.co.uk palette and fonts.

Palette (getquiet/css/style.css): bg #F7F5F2, ink #1A1A18, ink-soft #5A5A54,
accent #2D6A4F, protect #3A5A8C, protect-lt #D6E4F5, rule #E2DDD8.
Mark: the favicon "q" (circle + right-hand stem, getquiet/favicon.svg).
Wordmark: DM Serif Display, accent-coloured full stop (as the site nav).
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
OUT = HERE / "social"
OUT.mkdir(exist_ok=True)
SERIF = str(HERE / "fonts" / "DMSerifDisplay-Regular.ttf")
SANS = str(HERE / "fonts" / "DMSans[opsz,wght].ttf")

BG = (0xF7, 0xF5, 0xF2)
INK = (0x1A, 0x1A, 0x18)
INK_SOFT = (0x5A, 0x5A, 0x54)
ACCENT = (0x2D, 0x6A, 0x4F)
PROTECT = (0x3A, 0x5A, 0x8C)
PROTECT_LT = (0xD6, 0xE4, 0xF5)
RULE = (0xE2, 0xDD, 0xD8)

SS = 2  # supersample factor for smooth edges


def sans(size, weight=300):
    f = ImageFont.truetype(SANS, size)
    try:
        f.set_variation_by_axes([min(max(size / SS, 9), 40), weight])
    except Exception:
        pass
    return f


def serif(size):
    return ImageFont.truetype(SERIF, size)


def canvas(w, h, colour=BG):
    img = Image.new("RGB", (w * SS, h * SS), colour)
    return img, ImageDraw.Draw(img)


def finish(img, name):
    w, h = img.size
    img = img.resize((w // SS, h // SS), Image.LANCZOS)
    img.save(OUT / name, optimize=True)
    return OUT / name


def draw_q(d, cx, cy, unit, colour, dot=None):
    """The favicon q: viewBox 32, circle (13,13) r9 stroke 2; stem x22 y13->27.
    (cx, cy) is the centre of the mark's bounding box; unit = px per viewBox unit."""
    # bounding box of the mark in viewBox units: x 3..23, y 3..28 -> centre (13, 15.5)
    ox, oy = cx - 13 * unit, cy - 15.5 * unit
    sw = 2 * unit
    r = 9 * unit
    ccx, ccy = ox + 13 * unit, oy + 13 * unit
    d.ellipse([ccx - r - sw / 2, ccy - r - sw / 2, ccx + r + sw / 2, ccy + r + sw / 2], outline=colour, width=round(sw))
    x = ox + 22 * unit
    d.line([x, oy + 13 * unit, x, oy + 27 * unit], fill=colour, width=round(sw))
    cap = sw / 2
    d.ellipse([x - cap, oy + 27 * unit - cap, x + cap, oy + 27 * unit + cap], fill=colour)
    if dot:
        dr = 1.6 * unit
        dx, dy = ox + 27.5 * unit, oy + 27 * unit
        d.ellipse([dx - dr, dy - dr, dx + dr, dy + dr], fill=dot)


def wordmark(d, x, y, size, anchor="ls", text="Quiet Protect", colour=INK, dot=ACCENT):
    """Draw 'Quiet Protect.' with an accent full stop. anchor as PIL text anchors (baseline-based)."""
    f = serif(size)
    full = text + "."
    tw = d.textlength(full, font=f)
    if anchor[0] == "m":
        x0 = x - tw / 2
    elif anchor[0] == "r":
        x0 = x - tw
    else:
        x0 = x
    d.text((x0, y), text, font=f, fill=colour, anchor="ls")
    d.text((x0 + d.textlength(text, font=f), y), ".", font=f, fill=dot, anchor="ls")
    return tw


def centred(d, x, y, txt, font, fill, anchor="ms"):
    d.text((x, y), txt, font=font, fill=fill, anchor=anchor)


# 1. Facebook profile picture -- 720 x 720, shown as a circle.
img, d = canvas(720, 720, PROTECT_LT)
draw_q(d, 360 * SS, 372 * SS, 15.5 * SS, PROTECT, dot=ACCENT)
p1 = finish(img, "quietprotect-profile-720.png")

# 2. Facebook cover -- 1640 x 624; content kept in the central ~1000 px (mobile crops the sides).
W, H = 1640, 624
img, d = canvas(W, H)
d.rectangle([0, (H - 10) * SS, W * SS, H * SS], fill=PROTECT)
wordmark(d, W / 2 * SS, 300 * SS, 132 * SS, anchor="ms")
centred(d, W / 2 * SS, 380 * SS, "Weekly scam alerts for families looking out for someone online", sans(38 * SS, 300), INK_SOFT)
centred(d, W / 2 * SS, 450 * SS, "getquiet.co.uk", sans(30 * SS, 500), PROTECT)
p2 = finish(img, "quietprotect-facebook-cover-1640x624.png")

# 3. LinkedIn banner -- 1584 x 396; profile photo overlaps the bottom-left, so text sits right.
W, H = 1584, 396
img, d = canvas(W, H)
d.rectangle([0, (H - 8) * SS, W * SS, H * SS], fill=PROTECT)
rx = (W - 90) * SS
wordmark(d, rx, 185 * SS, 92 * SS, anchor="rs")
d.text((rx, 245 * SS), "Email protection for older and vulnerable people, with family in the loop", font=sans(28 * SS, 300), fill=INK_SOFT, anchor="rs")
d.text((rx, 300 * SS), "getquiet.co.uk", font=sans(24 * SS, 500), fill=PROTECT, anchor="rs")
p3 = finish(img, "quietprotect-linkedin-banner-1584x396.png")

# 4. Share (Open Graph) image -- 1200 x 630.
W, H = 1200, 630
img, d = canvas(W, H)
d.rectangle([0, (H - 12) * SS, W * SS, H * SS], fill=PROTECT)
draw_q(d, W / 2 * SS, 150 * SS, 4.2 * SS, PROTECT, dot=ACCENT)
wordmark(d, W / 2 * SS, 345 * SS, 108 * SS, anchor="ms")
centred(d, W / 2 * SS, 420 * SS, "Email protection for older and vulnerable people,", sans(34 * SS, 300), INK_SOFT)
centred(d, W / 2 * SS, 466 * SS, "with family in the loop", sans(34 * SS, 300), INK_SOFT)
centred(d, W / 2 * SS, 540 * SS, "getquiet.co.uk", sans(28 * SS, 500), PROTECT)
p4 = finish(img, "quietprotect-share-1200x630.png")

for p in (p1, p2, p3, p4):
    print(p, Image.open(p).size)
