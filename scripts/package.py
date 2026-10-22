#!/usr/bin/env python3
"""Package a built extension and its source without dependencies or private data."""

import hashlib
import json
import os
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
RELEASE = ROOT / "release"
EXCLUDED_DIRS = {
    ".git", "node_modules", "dist", "release", "test-artifacts", "playwright-profile",
    "coverage", "playwright-report", "test-results", "__pycache__",
}
EXCLUDED_NAMES = {".DS_Store"}


def source_files():
    for directory, folders, files in os.walk(ROOT):
        folders[:] = sorted(folder for folder in folders if folder not in EXCLUDED_DIRS)
        for name in sorted(files):
            if name in EXCLUDED_NAMES or name.startswith(".env"):
                continue
            if name.endswith((".local", ".log", ".pem", ".key", ".pyc")):
                continue
            file = Path(directory) / name
            if file.is_symlink():
                continue
            yield file


def add_file(archive, file, name):
    # Fixed timestamp and permissions make ZIP output independent of local file metadata.
    info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    archive.writestr(info, file.read_bytes(), compresslevel=9)


def main():
    package = json.loads((ROOT / "package.json").read_text())
    version = package["version"]
    manifest = json.loads((DIST / "manifest.json").read_text())
    if manifest["version"] != version or manifest["manifest_version"] != 3:
        raise SystemExit("Build and package versions must match, using Manifest V3.")
    RELEASE.mkdir(exist_ok=True)
    bundle_zip = RELEASE / f"SeekTab-{version}-unpacked.zip"
    source_zip = RELEASE / f"SeekTab-{version}-source.zip"
    instructions = """SeekTab — unpacked Chrome extension

1. Extract this ZIP and keep the SeekTab-unpacked directory in a permanent location.
2. Open chrome://extensions and enable Developer mode.
3. Click Load unpacked and select the directory containing manifest.json.
4. Open a new tab, keep SeekTab if asked, and enter your own DeepSeek API key in Settings.
5. Test connection (测试连接), then Save settings (保存设置).

Chrome 120+ is required. The interface currently uses Simplified Chinese.
No key is included. Connection testing sends one real search and may incur charges.
Keys are saved locally without encryption. No application backend or telemetry is used.

中文：解压后在 chrome://extensions 开启开发者模式，点击「加载已解压的扩展程序」，
选择包含 manifest.json 的文件夹。打开新标签页，在设置中填写自己的密钥、测试并保存。
密钥仅存于本机，未加密；连接测试可能产生 API 费用。

Documentation / 文档：https://github.com/Wayne-Shen/seektab
English README: https://github.com/Wayne-Shen/seektab/blob/main/README.md
中文说明：https://github.com/Wayne-Shen/seektab/blob/main/README_CN.md
"""
    with zipfile.ZipFile(bundle_zip, "w") as archive:
        for file in sorted(DIST.rglob("*")):
            if file.is_file():
                add_file(archive, file, "SeekTab-unpacked/" + file.relative_to(DIST).as_posix())
        info = zipfile.ZipInfo("SeekTab-unpacked/INSTALL.txt", (2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, instructions.encode("utf-8"), compresslevel=9)
    with zipfile.ZipFile(source_zip, "w") as archive:
        for file in sorted(source_files()):
            add_file(archive, file, "SeekTab-source/" + file.relative_to(ROOT).as_posix())
    sums = []
    for file in (bundle_zip, source_zip):
        with zipfile.ZipFile(file) as archive:
            if archive.testzip() is not None:
                raise SystemExit(f"ZIP integrity check failed: {file.name}")
        sums.append(hashlib.sha256(file.read_bytes()).hexdigest() + "  " + file.name)
        print(f"Created {file.name} ({file.stat().st_size:,} bytes)")
    (RELEASE / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n")


if __name__ == "__main__":
    main()
