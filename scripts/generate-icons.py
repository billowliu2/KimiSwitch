from PIL import Image, ImageDraw, ImageFont
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "src-tauri", "icons")
SVG_PATH = os.path.join(ROOT, "public", "kimi.svg")

os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(os.path.dirname(SVG_PATH), exist_ok=True)

# Brand colors: blue -> purple diagonal gradient
C_TOP = (59, 130, 246)    # #3b82f6
C_BOT = (139, 92, 246)    # #8b5cf6
DOT = (255, 255, 255, 230)


def lerp(a, b, t):
    return int(a + (b - a) * t)


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return m


def draw_icon(size):
    # Render at 4x then downscale for smooth edges
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # Diagonal gradient background
    grad = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        for x in range(0, S, 4):  # step to speed up; visually identical after downscale
            t = (x + y) / (2 * S)
            gd.line([(x, y), (min(x + 3, S - 1), y)],
                    fill=(lerp(C_TOP[0], C_BOT[0], t),
                          lerp(C_TOP[1], C_BOT[1], t),
                          lerp(C_TOP[2], C_BOT[2], t), 255))
    img.paste(grad, (0, 0), rounded_mask(S, int(S * 0.22)))

    draw = ImageDraw.Draw(img)

    # Bold "K"
    font_size = int(S * 0.52)
    font = None
    for name in ("segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"):
        try:
            font = ImageFont.truetype(name, font_size)
            break
        except Exception:
            continue
    if font is None:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), "K", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    # Optical center: shift slightly left/down to balance the toggle dot
    x = (S - tw) // 2 - bbox[0] - int(S * 0.02)
    y = (S - th) // 2 - bbox[1] + int(S * 0.02)
    draw.text((x, y), "K", font=font, fill=(255, 255, 255, 255))

    # Toggle dot (top-right) — the "switch" cue
    cx, cy = int(S * 0.74), int(S * 0.26)
    r = int(S * 0.075)
    ring = int(S * 0.018)
    draw.ellipse((cx - r - ring, cy - r - ring, cx + r + ring, cy + r + ring),
                 fill=(255, 255, 255, 90))
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=DOT)

    return img.resize((size, size), Image.LANCZOS)


# --- Tauri bundle icons ---
for s in (32, 128, 256):
    img = draw_icon(s)
    if s == 32:
        img.save(os.path.join(OUT_DIR, "32x32.png"))
    elif s == 128:
        img.save(os.path.join(OUT_DIR, "128x128.png"))
        draw_icon(256).save(os.path.join(OUT_DIR, "128x128@2x.png"))
    else:
        img.save(os.path.join(OUT_DIR, "icon.png"))

# Multi-size ICO
ico_sizes = [(32, 32), (64, 64), (128, 128), (256, 256)]
imgs = [draw_icon(s[0]) for s in ico_sizes]
imgs[0].save(os.path.join(OUT_DIR, "icon.ico"), format="ICO", sizes=ico_sizes)

# --- Web favicon / app SVG ---
svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="22" fill="url(#g)"/>
  <text x="48" y="70" text-anchor="middle" font-size="52" font-weight="700"
        fill="white" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">K</text>
  <circle cx="74" cy="26" r="9" fill="white" opacity="0.35"/>
  <circle cx="74" cy="26" r="6.5" fill="white" opacity="0.92"/>
</svg>'''
with open(SVG_PATH, "w", encoding="utf-8") as f:
    f.write(svg)

print("Icons generated.")
