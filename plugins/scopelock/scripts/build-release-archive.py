from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
import json


ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
MANIFEST = json.loads((ROOT / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
VERSION = MANIFEST["version"]
STAGE = DIST / f"scopelock-marketplace-{VERSION}"
ARCHIVE = DIST / f"scopelock-marketplace-{VERSION}.zip"
FIXED_TIME = (2026, 7, 16, 0, 0, 0)


def main():
    resolved_root = ROOT.resolve()
    resolved_stage = STAGE.resolve()
    if resolved_stage.parent != (resolved_root / "dist").resolve() or not resolved_stage.is_dir():
        raise SystemExit("Run the release stage builder before creating the archive.")
    if ARCHIVE.exists():
        ARCHIVE.unlink()

    with ZipFile(ARCHIVE, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for source in sorted(path for path in STAGE.rglob("*") if path.is_file()):
            relative = source.relative_to(STAGE).as_posix()
            info = ZipInfo(relative, date_time=FIXED_TIME)
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, source.read_bytes())

    print(ARCHIVE)


if __name__ == "__main__":
    main()
