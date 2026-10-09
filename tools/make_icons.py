# Draws the app icons: a 3x3 patch of azulejo-style tiles on navy.
from PIL import Image, ImageDraw
COLORS = [(47,120,224), (242,194,48), (220,74,63), (46,52,61), (39,181,168)]
for size in (192, 512):
    img = Image.new('RGB', (size, size), (11, 34, 64))
    d = ImageDraw.Draw(img)
    pad, gap = size * .14, size * .035
    cell = (size - 2 * pad - 2 * gap) / 3
    for r in range(3):
        for c in range(3):
            x, y = pad + c * (cell + gap), pad + r * (cell + gap)
            col = COLORS[(c + r) % 5]
            d.rounded_rectangle([x, y, x + cell, y + cell], radius=cell * .18, fill=col)
            d.rounded_rectangle([x + cell * .12, y + cell * .12, x + cell * .88, y + cell * .88], radius=cell * .12, outline=(255, 255, 255), width=max(1, size // 128))
    img.save(f'public/icon-{size}.png')
