"""Crops and numbered contact sheets of the marks, for the reading step.

A contact sheet holds at most 20 marks (4 columns x 5 rows): vision input
is downscaled to about 1568 px on the long edge, and a single sheet of 75
marks would shrink each cell too far to read. An overview of the whole page
gives context for prose and multi-box items."""
import numpy as np
from PIL import Image, ImageDraw, ImageFont

PER_SHEET = 20
COLS = 4
CELL = 360
LABEL_H = 40


def composite(gray, ink, alpha_min=64):
    """Scan in grey with the ink drawn in red, on the scan grid."""
    rgb = np.stack([gray] * 3, axis=-1).astype(np.uint8)
    rgb = (rgb * 0.55 + 255 * 0.45).astype(np.uint8)  # fade the print
    m = ink >= alpha_min
    rgb[m] = [220, 0, 0]
    return Image.fromarray(rgb)


def crop(img, c, pad):
    x0, y0 = max(0, c["x0"] - pad), max(0, c["y0"] - pad)
    x1, y1 = min(img.width, c["x1"] + pad), min(img.height, c["y1"] + pad)
    out = img.crop((x0, y0, x1, y1)).copy()
    d = ImageDraw.Draw(out)
    d.rectangle([c["x0"] - x0 - 3, c["y0"] - y0 - 3, c["x1"] - x0 + 3, c["y1"] - y0 + 3], outline=(0, 90, 255), width=3)
    return out


def contact_sheets(img, marks, space, per_sheet=PER_SHEET, cols=COLS, cell=CELL, label=lambda m: m["id"]):
    """[PIL.Image], one per chunk of at most `per_sheet` marks."""
    font = ImageFont.load_default(size=30)
    out = []
    for start in range(0, len(marks), per_sheet):
        chunk = marks[start:start + per_sheet]
        rows = (len(chunk) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cell, rows * (cell + LABEL_H)), "white")
        d = ImageDraw.Draw(sheet)
        for i, m in enumerate(chunk):
            c = crop(img, m, int(space * 3))
            c.thumbnail((cell - 10, cell - 10))
            x, y = (i % cols) * cell, (i // cols) * (cell + LABEL_H)
            sheet.paste(c, (x + 5, y + LABEL_H))
            d.text((x + 8, y + 4), str(label(m)), fill=(0, 0, 0), font=font)
        out.append(sheet)
    return out


def overview(img, marks, long_edge=2000):
    """The whole page, every mark boxed and labelled, for context."""
    out = img.copy()
    d = ImageDraw.Draw(out)
    font = ImageFont.load_default(size=22)
    for m in marks:
        d.rectangle([m["x0"], m["y0"], m["x1"], m["y1"]], outline=(0, 90, 255), width=2)
        d.text((m["x0"], max(0, m["y0"] - 20)), m["id"], fill=(0, 90, 255), font=font)
    scale = long_edge / max(out.width, out.height)
    if scale < 1:
        out = out.resize((max(1, int(round(out.width * scale))), max(1, int(round(out.height * scale)))))
    return out
