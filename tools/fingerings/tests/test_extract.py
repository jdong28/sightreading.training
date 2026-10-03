"""Unit tests for extract.py: synthetic PDFs built with pikepdf directly."""
import numpy as np
import pikepdf
import pytest
from pikepdf import Dictionary, Name

from fingerings import extract

PAGE_SIZE = (200.0, 300.0)


def _gray_scan(pdf, w=20, h=30, fill=255):
    data = bytes([fill]) * (w * h)
    return pdf.make_stream(data, Dictionary(
        Type=Name.XObject, Subtype=Name.Image, Width=w, Height=h,
        BitsPerComponent=8, ColorSpace=Name.DeviceGray))


def _ink_image(pdf, w=10, h=15, alpha_region=None):
    rgb = bytes([200, 0, 0]) * (w * h)
    alpha = np.zeros((h, w), dtype=np.uint8)
    if alpha_region:
        y0, y1, x0, x1 = alpha_region
        alpha[y0:y1, x0:x1] = 255
    inkobj = pdf.make_stream(rgb, Dictionary(
        Type=Name.XObject, Subtype=Name.Image, Width=w, Height=h,
        BitsPerComponent=8, ColorSpace=Name.DeviceRGB))
    smask = pdf.make_stream(alpha.tobytes(), Dictionary(
        Type=Name.XObject, Subtype=Name.Image, Width=w, Height=h,
        BitsPerComponent=8, ColorSpace=Name.DeviceGray))
    inkobj.SMask = smask
    return inkobj


def _new_pdf_with_scan_and_ink(alpha_region=(5, 10, 3, 7)):
    pdf = pikepdf.Pdf.new()
    page = pdf.add_blank_page(page_size=PAGE_SIZE)
    scan = _gray_scan(pdf)
    ink = _ink_image(pdf, alpha_region=alpha_region)
    page.obj.Resources = Dictionary(XObject=Dictionary(Scan=scan, Ink=ink))
    content = (f"q {PAGE_SIZE[0]} 0 0 {PAGE_SIZE[1]} 0 0 cm /Scan Do Q "
               f"q {PAGE_SIZE[0]} 0 0 {PAGE_SIZE[1]} 0 0 cm /Ink Do Q").encode("ascii")
    page.obj.Contents = pdf.make_stream(content)
    return pdf


def test_image_inside_form_xobject_found_with_right_bbox():
    pdf = pikepdf.Pdf.new()
    page = pdf.add_blank_page(page_size=PAGE_SIZE)
    img = pdf.make_stream(bytes([128]) * 4, Dictionary(
        Type=Name.XObject, Subtype=Name.Image, Width=2, Height=2,
        BitsPerComponent=8, ColorSpace=Name.DeviceGray))
    # the form's own matrix scales the unit square by 2x before the
    # invoking cm places it on the page
    form_content = b"q 1 0 0 1 0 0 cm /Im0 Do Q"
    form = pdf.make_stream(form_content, Dictionary(
        Type=Name.XObject, Subtype=Name.Form, BBox=pikepdf.Array([0, 0, 1, 1]),
        Matrix=pikepdf.Array([2, 0, 0, 2, 0, 0]), Resources=Dictionary(XObject=Dictionary(Im0=img))))
    page.obj.Resources = Dictionary(XObject=Dictionary(Fm0=form))
    page.obj.Contents = pdf.make_stream(b"q 50 0 0 50 10 10 cm /Fm0 Do Q")

    images = []
    resources = extract._page_resources(page)
    extract._find_images(page.obj, resources, extract.IDENTITY, images)
    assert len(images) == 1
    ctm = images[0]["ctm"]
    # unit square -> form matrix (2x) -> outer cm (50x at 10,10): final
    # scale is 100, placed at (10,10) in page (PDF, y-up) space
    bbox = extract._unit_square_bbox(ctm)
    assert bbox == pytest.approx((10.0, 10.0, 110.0, 110.0))


def test_known_ink_pixel_lands_at_right_scan_pixel():
    pdf = _new_pdf_with_scan_and_ink(alpha_region=(5, 10, 3, 7))  # ink image is 10x15
    L = extract.page_layers(pdf, 0)
    mask = extract.ink_mask(L["ink"])
    # scan is 20x30 over a 10x15 ink image: exactly 2x in both dimensions
    assert mask[10:20, 6:14].all()
    assert not mask[0:10, :].any()
    assert not mask[:, 0:6].any()
    assert not mask[:, 14:].any()


def test_1bit_scan_with_decode_1_0_is_inverted():
    pdf = pikepdf.Pdf.new()
    page = pdf.add_blank_page(page_size=PAGE_SIZE)
    w, h = 8, 8
    # all bits 1: with the default Decode this is all-white; with
    # Decode [1 0] it must read back as all-black
    data = bytes([0xFF]) * ((w + 7) // 8 * h)
    scan = pdf.make_stream(data, Dictionary(
        Type=Name.XObject, Subtype=Name.Image, Width=w, Height=h,
        BitsPerComponent=1, ColorSpace=Name.DeviceGray, Decode=pikepdf.Array([1, 0])))
    page.obj.Resources = Dictionary(XObject=Dictionary(Scan=scan))
    page.obj.Contents = pdf.make_stream(
        f"q {PAGE_SIZE[0]} 0 0 {PAGE_SIZE[1]} 0 0 cm /Scan Do Q".encode("ascii"))
    L = extract.page_layers(pdf, 0)
    assert (L["scan"]["gray"] == 0).all()


def test_rotate_90_raises():
    pdf = pikepdf.Pdf.new()
    page = pdf.add_blank_page(page_size=PAGE_SIZE)
    page.obj.Rotate = 90
    with pytest.raises(ValueError, match="Rotate"):
        extract.page_layers(pdf, 0)


def test_ink_annotation_found_near_its_rect():
    pdf = pikepdf.Pdf.new()
    page = pdf.add_blank_page(page_size=PAGE_SIZE)
    scan = _gray_scan(pdf)
    page.obj.Resources = Dictionary(XObject=Dictionary(Scan=scan))
    page.obj.Contents = pdf.make_stream(
        f"q {PAGE_SIZE[0]} 0 0 {PAGE_SIZE[1]} 0 0 cm /Scan Do Q".encode("ascii"))
    # a minimal Ink annotation with an appearance stream covering a small
    # rect near the middle of the page
    rect = [80, 130, 120, 170]
    ap_content = b"1 0 0 RG 4 w 0 0 m 40 40 l S"
    ap = pdf.make_stream(ap_content, Dictionary(
        Type=Name.XObject, Subtype=Name.Form, BBox=pikepdf.Array([0, 0, 40, 40])))
    annot = Dictionary(Type=Name.Annot, Subtype=Name.Ink, Rect=pikepdf.Array(rect),
                        AP=Dictionary(N=ap))
    page.obj.Annots = pikepdf.Array([annot])
    L = extract.page_layers(pdf, 0)
    assert L["ink_sources"] == ["annots:Ink"]
    mask = extract.ink_mask(L["ink"])
    sx, sy = L["px_per_pt"]
    # some ink pixel exists within (a little outside) the annotation's
    # rect, converted to the scan's top-down pixel grid
    px0, py0 = L["to_px"](rect[0], PAGE_SIZE[1] - rect[3])
    px1, py1 = L["to_px"](rect[2], PAGE_SIZE[1] - rect[1])
    pad = 10
    region = mask[max(0, int(py0) - pad):int(py1) + pad, max(0, int(px0) - pad):int(px1) + pad]
    assert region.any()


def test_born_digital_renders_with_ink_hidden():
    pdf = pikepdf.Pdf.new()
    page = pdf.add_blank_page(page_size=PAGE_SIZE)
    ink = _ink_image(pdf, alpha_region=(2, 13, 2, 8))
    page.obj.Resources = Dictionary(XObject=Dictionary(Ink=ink))
    # vector content: a filled black rectangle (the "print"), plus the ink
    # overlay on top
    content = (b"0 0 0 rg 20 20 50 50 re f "
               + f"q {PAGE_SIZE[0]} 0 0 {PAGE_SIZE[1]} 0 0 cm /Ink Do Q".encode("ascii"))
    page.obj.Contents = pdf.make_stream(content)
    L = extract.page_layers(pdf, 0, render_scale=3)
    gray = L["scan"]["gray"]
    h, w = gray.shape
    # the ink's own region (roughly the top-left of the page): no dark
    # (print-looking) pixels under it, since the ink was hidden before
    # rendering
    y0, y1 = int(0.05 * h), int(0.5 * h)
    x0, x1 = int(0.05 * w), int(0.5 * w)
    assert gray[y0:y1, x0:x1].min() == 255
    # the black rectangle itself is still rendered (print wasn't hidden)
    assert (gray < 128).any()
