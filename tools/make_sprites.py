# Crops the five tile sprites out of the top wall row of the board photo (public/img/board.jpg).
from PIL import Image
im = Image.open('public/img/board.jpg').convert('RGB')
XS = [504, 582, 660, 737, 814]; Y = 357; H = 31   # centers of wall row 0: blue, yellow, red, black, teal
for i, x in enumerate(XS):
    im.crop((x - H, Y - H, x + H, Y + H)).resize((64, 64), Image.LANCZOS).save(f'public/img/t{i}.png', optimize=True)
m = Image.new('RGB', (64 * 5, 64))
for i in range(5): m.paste(Image.open(f'public/img/t{i}.png'), (64 * i, 0))
m.save('sprites_preview.png')
