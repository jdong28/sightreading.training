"""The `fingerings` command: run, batch, apply-layer."""
import argparse
import json
import sys
from pathlib import Path

from . import batch as batch_mod
from . import geometry as geometry_mod
from . import layer, manifest, score, scoreio
from . import run as run_mod


def _cmd_run(args):
    try:
        report, code = run_mod.run(args.run_dir)
    except (manifest.ManifestError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return code


def _cmd_geometry(args):
    try:
        report, code = geometry_mod.run_geometry(args.run_dir, overlays=args.overlays)
    except (manifest.ManifestError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return code


def _cmd_batch(args):
    summary, code = batch_mod.run_batch(args.batch_dir)
    for row in summary["runs"]:
        print(row["piece"], row["status"])
    return code


def _cmd_apply_layer(args):
    lay = json.loads(Path(args.layer).read_text())
    is_mxl = scoreio.is_mxl(args.in_path)
    if is_mxl:
        root_name, text = scoreio.read_mxl_text(args.in_path)
    else:
        root_name, text = None, scoreio.read_text(args.in_path)
    root = score.load_text(text)
    result = layer.apply_to_text(lay, text, root)
    if result["ok"]:
        if is_mxl:
            scoreio.write_mxl(args.in_path, args.out_path, root_name, result["text"])
        else:
            scoreio.write_text(args.out_path, result["text"])
    print(json.dumps(dict(applied=result["applied"], same=result["same"],
                           conflicts=result["conflicts"], unmatched=result["unmatched"]), default=str))
    return 0 if result["ok"] else 1


def build_parser():
    p = argparse.ArgumentParser(prog="fingerings")
    sub = p.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="run one piece end to end")
    p_run.add_argument("run_dir")
    p_run.set_defaults(func=_cmd_run)

    p_geom = sub.add_parser("geometry", help="check a piece's geometry (staves, bars, heads) on every page")
    p_geom.add_argument("run_dir")
    p_geom.add_argument("--overlays", action="store_true", help="also write geometry/pN.png diagnostic overlays")
    p_geom.set_defaults(func=_cmd_geometry)

    p_batch = sub.add_parser("batch", help="run every piece in a batch directory")
    p_batch.add_argument("batch_dir")
    p_batch.set_defaults(func=_cmd_batch)

    p_apply = sub.add_parser("apply-layer", help="apply a fingering layer to a MusicXML file")
    p_apply.add_argument("layer")
    p_apply.add_argument("in_path")
    p_apply.add_argument("out_path")
    p_apply.set_defaults(func=_cmd_apply_layer)

    return p


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
