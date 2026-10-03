"""Stage 1: split each PDF page into its scan and its markup ink.

Three markup forms are read:
- an image with a soft mask over the scan (iOS/iPadOS Markup flattens the
  pen strokes into one RGB image whose SMask alpha is exactly the ink);
- PDF annotations (Ink, FreeText, ...; Preview, Acrobat, GoodNotes exports),
  found by rendering the page with and without annotations;
- a born-digital page with no scan image at all: it is rasterised with
  pypdfium2, with the ink image hidden first (otherwise red ink renders to
  mid-grey and is mistaken for print).
Everything is mapped to one raster grid: the scan's own pixels (or the
pypdfium2 render, standing in for a scan, on a born-digital page).

Finding an image's placement walks the page's content stream (recursing
into Form XObjects, a markup app commonly wraps the original page in one),
tracking q/Q/cm; the image's bbox is its CTM applied to the unit square. A
page or image CTM with rotation or skew, or a page /Rotate, is refused:
geometry hardening for those belongs to a follow-up task."""
import io

import numpy as np
import pikepdf
import pypdfium2 as pdfium
from pikepdf import Name

IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def _mat_mul(m1, m2):
    """The matrix equivalent to applying m1 then m2 to a point."""
    a1, b1, c1, d1, e1, f1 = m1
    a2, b2, c2, d2, e2, f2 = m2
    return (
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2,
        e1 * b2 + f1 * d2 + f2,
    )


def _apply(m, x, y):
    a, b, c, d, e, f = m
    return a * x + c * y + e, b * x + d * y + f


def _unit_square_bbox(ctm):
    xs, ys = zip(*(_apply(ctm, x, y) for x, y in ((0, 0), (1, 0), (0, 1), (1, 1))))
    return min(xs), min(ys), max(xs), max(ys)


def _refuse_if_skewed(ctm, where):
    _, b, c, _, _, _ = ctm
    if abs(b) > 1e-6 or abs(c) > 1e-6:
        raise ValueError(f"{where}: a rotated or skewed image placement isn't supported "
                          "(geometry hardening on more engravings is a follow-up task)")


def _page_resources(page):
    obj = page.obj
    seen = set()
    while obj is not None:
        if "/Resources" in obj:
            return obj.Resources
        parent = obj.get("/Parent")
        if parent is None or id(parent) in seen:
            break
        seen.add(id(parent))
        obj = parent
    return pikepdf.Dictionary()


def _find_images(stream_obj, resources, ctm, out):
    """Walk a page's or a Form XObject's content stream, collecting each
    image Do with its CTM in page space; recurses into Form XObjects,
    multiplying by the form's own /Matrix and using its own /Resources when
    it has one."""
    stack = []
    cur = ctm
    for instr in pikepdf.parse_content_stream(stream_obj):
        op = str(instr.operator)
        if op == "q":
            stack.append(cur)
        elif op == "Q":
            if stack:
                cur = stack.pop()
        elif op == "cm":
            a, b, c, d, e, f = (float(x) for x in instr.operands)
            cur = _mat_mul((a, b, c, d, e, f), cur)
        elif op == "Do":
            xobjects = resources.get("/XObject") if resources else None
            xobj = xobjects.get(instr.operands[0]) if xobjects is not None else None
            if xobj is None:
                continue
            subtype = xobj.get("/Subtype")
            if subtype == Name.Image:
                out.append(dict(xobj=xobj, ctm=cur))
            elif subtype == Name.Form:
                matrix = xobj.get("/Matrix")
                form_m = tuple(float(x) for x in matrix) if matrix is not None else IDENTITY
                form_ctm = _mat_mul(form_m, cur)
                form_resources = xobj.get("/Resources")
                if form_resources is None:
                    form_resources = resources
                _find_images(xobj, form_resources, form_ctm, out)


def _page_box(page):
    """(x0, y0, x1, y1), the CropBox falling back to the MediaBox (pikepdf's
    `.cropbox` already does that), as plain floats."""
    x0, y0, x1, y1 = (float(v) for v in page.cropbox)
    return x0, y0, x1, y1


def _to_top_down(bbox, page_box):
    """A page-space (PDF, y-up) bbox to top-down coordinates with the
    origin at the page box's top-left corner."""
    x0, y0, x1, y1 = bbox
    px0, _, _, py1 = page_box
    return x0 - px0, py1 - y1, x1 - px0, py1 - y0


def _covers(bbox, page_w, page_h, frac=0.8):
    x0, y0, x1, y1 = bbox
    return (x1 - x0) > frac * page_w and (y1 - y0) > frac * page_h


def _as_pil_array(xobj):
    try:
        img = pikepdf.PdfImage(xobj)
        pil = img.as_pil_image()
    except Exception as e:  # noqa: BLE001
        filt = xobj.get("/Filter")
        raise ValueError(f"can't decode an image with filter {filt}: {e}") from e
    return pil


def _scan_gray(xobj):
    pil = _as_pil_array(xobj).convert("L")
    arr = np.asarray(pil, dtype=np.uint8)
    decode = xobj.get("/Decode")
    if decode is not None and [int(v) for v in decode] == [1, 0]:
        arr = 255 - arr
    return arr


def _ink_alpha(xobj):
    smask = xobj.SMask
    pil = _as_pil_array(smask)
    if pil.mode != "L":
        pil = pil.convert("L")
    return np.asarray(pil, dtype=np.uint8)


def _hide_ink(pdf_bytes, ink_xobjs_objgen):
    """A copy of the PDF with each ink image's own pixels and SMask
    replaced by a 1x1, alpha-0 image, so rendering the page for its
    "scan" doesn't paint the ink (red ink would otherwise render to
    mid-grey and read as print)."""
    pdf = pikepdf.open(io.BytesIO(pdf_bytes))
    for obj in pdf.objects:
        if not isinstance(obj, pikepdf.Object) or not obj.is_indirect:
            continue
        if obj.objgen not in ink_xobjs_objgen:
            continue
        obj.write(bytes([255]))
        obj.Width = 1
        obj.Height = 1
        obj.BitsPerComponent = 8
        obj.ColorSpace = Name.DeviceGray
        smask = obj.get("/SMask")
        if smask is not None:
            smask.write(bytes([0]))
            smask.Width = 1
            smask.Height = 1
            smask.BitsPerComponent = 8
            smask.ColorSpace = Name.DeviceGray
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()


def _annotation_ink(pdf_bytes, pno, sx, out_h, out_w):
    """Per-pixel max channel difference between the page rendered with and
    without its annotations, resampled onto (out_h, out_w): the ink of an
    Ink/FreeText/... annotation (Preview, Acrobat, GoodNotes exports).
    pypdfium2 renders at one scale only (sx); a scan grid with a different
    sy is matched by a nearest-neighbour resample, same as the ink SMask."""
    doc = pdfium.PdfDocument(pdf_bytes)
    page = doc[pno]
    on = page.render(scale=sx, draw_annots=True).to_numpy()[:, :, :3].astype(np.int16)
    off = page.render(scale=sx, draw_annots=False).to_numpy()[:, :, :3].astype(np.int16)
    diff = np.abs(on - off).max(axis=2).astype(np.uint8)
    rh, rw = diff.shape
    if (rh, rw) == (out_h, out_w):
        return diff
    ry = np.clip((np.arange(out_h) * rh / out_h).astype(int), 0, rh - 1)
    rx = np.clip((np.arange(out_w) * rw / out_w).astype(int), 0, rw - 1)
    return diff[ry][:, rx]


def _annotation_subtypes(page):
    annots = page.obj.get("/Annots")
    if not annots:
        return []
    return sorted({str(a.get("/Subtype"))[1:] for a in annots if a.get("/Subtype") is not None})


def page_layers(pdf, pno, render_scale=6):
    """pdf: an open pikepdf.Pdf. pno: 0-indexed page number. Returns
    dict(page, scan, ink, ink_sources, px_per_pt, to_px)."""
    page = pdf.pages[pno]
    if page.rotation != 0:
        raise ValueError(f"page {pno + 1}: /Rotate {page.rotation} isn't supported "
                          "(geometry hardening on more engravings is a follow-up task)")
    page_box = _page_box(page)
    page_w, page_h = page_box[2] - page_box[0], page_box[3] - page_box[1]
    resources = _page_resources(page)
    images = []
    _find_images(page.obj, resources, IDENTITY, images)
    for im in images:
        _refuse_if_skewed(im["ctm"], f"page {pno + 1}")
        im["bbox"] = _to_top_down(_unit_square_bbox(im["ctm"]), page_box)

    ink_im = None
    scan_im = None
    for im in images:
        xobj = im["xobj"]
        if not _covers(im["bbox"], page_w, page_h):
            continue
        if "/SMask" in xobj:
            ink_im = im
        else:
            area = int(xobj.get("/Width", 0)) * int(xobj.get("/Height", 0))
            if scan_im is None or area > scan_im["_area"]:
                im["_area"] = area
                scan_im = im

    sources = []
    if scan_im is not None:
        xobj = scan_im["xobj"]
        gray = _scan_gray(xobj)
        h, w = gray.shape
        scan = dict(bbox=scan_im["bbox"], w=w, h=h, gray=gray)
    else:
        # born-digital: rasterise with pypdfium2, ink image hidden first
        buf = io.BytesIO()
        pdf.save(buf)
        pdf_bytes = buf.getvalue()
        if ink_im is not None:
            pdf_bytes = _hide_ink(pdf_bytes, {ink_im["xobj"].objgen})
        doc = pdfium.PdfDocument(pdf_bytes)
        bmp = doc[pno].render(scale=render_scale, grayscale=True, draw_annots=False, may_draw_forms=False)
        gray = bmp.to_numpy()
        h, w = gray.shape
        scan = dict(bbox=(0.0, 0.0, page_w, page_h), w=w, h=h, gray=gray)

    sx = scan["w"] / (scan["bbox"][2] - scan["bbox"][0])
    sy = scan["h"] / (scan["bbox"][3] - scan["bbox"][1])
    to_px = lambda x, y: ((x - scan["bbox"][0]) * sx, (y - scan["bbox"][1]) * sy)  # noqa: E731

    layer = np.zeros((scan["h"], scan["w"]), dtype=np.uint8)
    if ink_im is not None:
        a = _ink_alpha(ink_im["xobj"])
        bx0, by0, bx1, by1 = ink_im["bbox"]
        ys = np.arange(scan["h"]) / sy + scan["bbox"][1]
        xs = np.arange(scan["w"]) / sx + scan["bbox"][0]
        iy = np.clip(((ys - by0) * a.shape[0] / (by1 - by0)).astype(int), 0, a.shape[0] - 1)
        ix = np.clip(((xs - bx0) * a.shape[1] / (bx1 - bx0)).astype(int), 0, a.shape[1] - 1)
        layer = np.maximum(layer, a[iy][:, ix])
        sources.append("image-smask")

    subtypes = _annotation_subtypes(page)
    if subtypes:
        buf = io.BytesIO()
        pdf.save(buf)
        diff = _annotation_ink(buf.getvalue(), pno, sx, scan["h"], scan["w"])
        layer = np.maximum(layer, diff)
        sources.append(f"annots:{','.join(subtypes)}")

    return dict(page=pno + 1, scan=scan, ink=layer, ink_sources=sources,
                px_per_pt=(sx, sy), to_px=to_px)


def ink_mask(layer, threshold=64):
    return layer >= threshold
