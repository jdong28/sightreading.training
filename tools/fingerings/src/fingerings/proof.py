"""A proof sheet: each item's mark (blue box) and, for a placement, the
notehead it was given (green ring), labelled for the instructor to check.

Order and the "#i" numbering are the caller's (run.py assigns them, shared
with report.md): left for review first (skips, with the reason wrapped
onto two lines), then placements flagged review, then every other
placement, then marks that aren't fingerings (so a digit misread as
"other" is caught)."""
import textwrap

from PIL import Image, ImageDraw, ImageFont

PER_SHEET = 20
COLS = 5
CELL = 420
LABEL_H = 60


def _font(size):
    return ImageFont.load_default(size=size)


def sheets_for_page(img, items, per_sheet=PER_SHEET, cols=COLS, cell=CELL):
    """items: ordered [{proof, box: (x0,y0,x1,y1), head: (x,y) | None,
    label, sub}], already filtered to one page and in the caller's order.
    [PIL.Image], one per chunk of at most `per_sheet` items."""
    font = _font(20)
    out = []
    for start in range(0, len(items), per_sheet):
        chunk = items[start:start + per_sheet]
        rows = (len(chunk) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cell, rows * (cell + LABEL_H)), "white")
        d = ImageDraw.Draw(sheet)
        for i, it in enumerate(chunk):
            x0, y0, x1, y1 = it["box"]
            pad = 150
            bx0, by0, bx1, by1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
            if it.get("head"):
                hx, hy = it["head"]
                bx0, by0 = min(bx0, hx - 60), min(by0, hy - 60)
                bx1, by1 = max(bx1, hx + 60), max(by1, hy + 60)
            c = img.crop((int(bx0), int(by0), int(bx1), int(by1))).copy()
            cd = ImageDraw.Draw(c)
            cd.rectangle([x0 - bx0 - 4, y0 - by0 - 4, x1 - bx0 + 4, y1 - by0 + 4], outline=(0, 90, 255), width=4)
            if it.get("head"):
                hx, hy = it["head"]
                cd.ellipse([hx - bx0 - 24, hy - by0 - 18, hx - bx0 + 24, hy - by0 + 18], outline=(0, 170, 0), width=6)
            c.thumbnail((cell - 10, cell - 10))
            x, y = (i % cols) * cell, (i // cols) * (cell + LABEL_H)
            sheet.paste(c, (x + 5, y + LABEL_H))
            label = f"#{it['proof']} {it['label']}"
            sub = "\n".join(textwrap.wrap(it.get("sub", ""), width=46)[:2])
            d.text((x + 6, y + 2), label, fill=(0, 0, 0), font=font)
            d.text((x + 6, y + 24), sub, fill=(90, 90, 90), font=font)
        out.append(sheet)
    return out
