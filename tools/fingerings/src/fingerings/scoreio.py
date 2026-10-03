"""Read and write a score's MusicXML text byte-faithfully (UTF-8, no
newline translation, BOM and CRLF preserved), and the .mxl container around
it: the root score member, resolved from META-INF/container.xml or the
first .xml/.musicxml member outside META-INF, repacked with every other
member's content and ZipInfo metadata unchanged."""
import zipfile
from pathlib import Path
from lxml import etree

UTF16_BOMS = (b"\xff\xfe", b"\xfe\xff")


def _check_utf16(path, data):
    if data[:2] in UTF16_BOMS:
        raise ValueError(f"{path}: UTF-16 encoded MusicXML is not supported")


def read_text(path):
    # Path.read_text's `newline` kwarg needs Python 3.13; open() has always
    # taken it, and newline="" is what disables newline translation.
    data = Path(path).read_bytes()
    _check_utf16(path, data)
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def write_text(path, text):
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def mxl_root_name(zf):
    """The container's root score member name, falling back to the first
    .xml/.musicxml member outside META-INF."""
    try:
        container = zf.read("META-INF/container.xml")
    except KeyError:
        container = None
    if container:
        root = etree.fromstring(container)
        rootfile = root.find(".//{*}rootfile")
        path = rootfile.get("full-path") if rootfile is not None else None
        if path:
            return path
    for name in zf.namelist():
        if name.startswith("META-INF/"):
            continue
        if name.lower().endswith((".xml", ".musicxml")):
            return name
    raise ValueError("no root score found in .mxl: no META-INF/container.xml and no .xml/.musicxml member")


def read_mxl_text(path):
    """(root member name, its text). Raises on a UTF-16 root member."""
    with zipfile.ZipFile(path) as zf:
        name = mxl_root_name(zf)
        data = zf.read(name)
    _check_utf16(path, data)
    return name, data.decode("utf-8")


def write_mxl(src_path, dst_path, root_name, new_text):
    """Repack src_path's zip into dst_path with root_name's content replaced
    by new_text; every other member's content and ZipInfo (order, date_time,
    compress_type, attributes) stay the same."""
    with zipfile.ZipFile(src_path) as src, zipfile.ZipFile(dst_path, "w") as dst:
        for info in src.infolist():
            data = new_text.encode("utf-8") if info.filename == root_name else src.read(info.filename)
            new_info = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            new_info.compress_type = info.compress_type
            new_info.external_attr = info.external_attr
            new_info.internal_attr = info.internal_attr
            new_info.create_system = info.create_system
            new_info.create_version = info.create_version
            new_info.extract_version = info.extract_version
            new_info.flag_bits = info.flag_bits & ~0x8  # no data descriptor; size is known
            new_info.comment = info.comment
            new_info.extra = info.extra
            dst.writestr(new_info, data)


def is_mxl(path):
    return str(path).lower().endswith(".mxl")
