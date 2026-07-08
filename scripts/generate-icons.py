from PIL import Image, ImageDraw, ImageFont
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "src-tauri", "icons")
SVG_PATH = os.path.join(ROOT, "public", "pi.svg")

os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(os.path.dirname(SVG_PATH), exist_ok=True)

def draw_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Gradient-ish circular background: blue -> purple
    for y in range(size):
        ratio = y / size
        r = int(59 + (139 - 59) * ratio)
        g = int(130 + (92 - 130) * ratio)
        b = int(246 + (246 - 246) * ratio)
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))

    # Clip to circle
    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.ellipse((0, 0, size, size), fill=255)
    img.putalpha(mask)

    # Draw π symbol
    font_size = int(size * 0.55)
    try:
        font = ImageFont.truetype("segoeui.ttf", font_size)
    except Exception:
        try:
            font = ImageFont.truetype("arial.ttf", font_size)
        except Exception:
            font = ImageFont.load_default()

    draw = ImageDraw.Draw(img)
    text = "π"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (size - text_w) // 2 - bbox[0]
    y = (size - text_h) // 2 - bbox[1]
    draw.text((x, y), text, font=font, fill=(255, 255, 255, 255))
    return img

sizes = [32, 128, 256]
for s in sizes:
    img = draw_icon(s)
    if s == 128:
        img.save(os.path.join(OUT_DIR, "128x128.png"))
        img2x = draw_icon(256)
        img2x.save(os.path.join(OUT_DIR, "128x128@2x.png"))
    elif s == 32:
        img.save(os.path.join(OUT_DIR, "32x32.png"))

# Multi-size ICO
ico_sizes = [(32, 32), (64, 64), (128, 128), (256, 256)]
imgs = [draw_icon(s[0]) for s in ico_sizes]
imgs[0].save(
    os.path.join(OUT_DIR, "icon.ico"),
    format="ICO",
    sizes=ico_sizes,
)

# Simple SVG favicon for the web
svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="48" fill="url(#g)"/>
  <text x="50" y="66" text-anchor="middle" font-size="50" fill="white" font-family="system-ui, -apple-system, sans-serif">π</text>
</svg>'''
with open(SVG_PATH, "w", encoding="utf-8") as f:
    f.write(svg)

print("Icons generated.")
