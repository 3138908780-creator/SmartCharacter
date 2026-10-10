#!/usr/bin/env python3
"""Download the OFL fonts used by the local editor on first run."""

from __future__ import annotations

import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "public" / "fonts"
LICENSE_DIR = FONT_DIR / "licenses"

FONTS = [
    {
        "file": "NotoSansCJKsc-Bold.otf",
        "url": "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf",
        "license": "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE",
    },
    {
        "file": "NotoSerifCJKsc-Bold.otf",
        "url": "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Bold.otf",
        "license": "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/LICENSE",
    },
    {
        "file": "NotoSerifCJKsc-Black.otf",
        "url": "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Black.otf",
        "license": "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/LICENSE",
    },
    {
        "file": "NotoSansCJKsc-Regular.otf",
        "url": "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf",
        "license": "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE",
    },
    {
        "file": "NotoSerifCJKsc-Regular.otf",
        "url": "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Regular.otf",
        "license": "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/LICENSE",
    },
    {
        "file": "LXGWWenKai-Regular.ttf",
        "url": "https://raw.githubusercontent.com/lxgw/LxgwWenKai/main/fonts/TTF/LXGWWenKai-Regular.ttf",
        "license": "https://raw.githubusercontent.com/lxgw/LxgwWenKai/main/OFL.txt",
    },
    {
        "file": "SmileySans-Oblique.ttf",
        "url": "https://github.com/atelier-anchor/smiley-sans/releases/download/v2.0.1/smiley-sans-v2.0.1.zip",
        "archive_member": "SmileySans-Oblique.ttf",
        "license": "https://raw.githubusercontent.com/atelier-anchor/smiley-sans/main/LICENSE",
    },
    {
        "file": "DouyinSansBold.ttf",
        "url": "https://raw.githubusercontent.com/bytedance/fonts/main/DouyinSans/DouyinSansBold.ttf",
        "license": "https://raw.githubusercontent.com/bytedance/fonts/main/DouyinSans/OFL.txt",
    },
    {
        "file": "MaShanZheng-Regular.ttf",
        "url": "https://raw.githubusercontent.com/google/fonts/main/ofl/mashanzheng/MaShanZheng-Regular.ttf",
        "license": "https://raw.githubusercontent.com/google/fonts/main/ofl/mashanzheng/OFL.txt",
    },
    {
        "file": "LongCang-Regular.ttf",
        "url": "https://raw.githubusercontent.com/google/fonts/main/ofl/longcang/LongCang-Regular.ttf",
        "license": "https://raw.githubusercontent.com/google/fonts/main/ofl/longcang/OFL.txt",
    },
    {
        "file": "LiuJianMaoCao-Regular.ttf",
        "url": "https://raw.githubusercontent.com/google/fonts/main/ofl/liujianmaocao/LiuJianMaoCao-Regular.ttf",
        "license": "https://raw.githubusercontent.com/google/fonts/main/ofl/liujianmaocao/OFL.txt",
    },
    {
        "file": "ZhiMangXing-Regular.ttf",
        "url": "https://raw.githubusercontent.com/google/fonts/main/ofl/zhimangxing/ZhiMangXing-Regular.ttf",
        "license": "https://raw.githubusercontent.com/google/fonts/main/ofl/zhimangxing/OFL.txt",
    },
    {
        "file": "TiejiliSC-Regular.ttf",
        "url": "https://raw.githubusercontent.com/Buernia/Tiejili/main/fonts/ttf/TiejiliSC-Regular.ttf",
        "license": "https://raw.githubusercontent.com/Buernia/Tiejili/main/LICENSE",
    },
]


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".download")
    try:
        with urllib.request.urlopen(url, timeout=120) as response, partial.open("wb") as output:
            shutil.copyfileobj(response, output)
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)


def prepare_font(item: dict[str, str]) -> None:
    destination = FONT_DIR / item["file"]
    if not destination.exists() or destination.stat().st_size < 100_000:
        print(f"Preparing local font: {item['file']}", flush=True)
        if "archive_member" in item:
            with tempfile.TemporaryDirectory(prefix="smart-character-font-") as directory:
                archive = Path(directory) / "font.zip"
                download(item["url"], archive)
                with zipfile.ZipFile(archive) as bundle:
                    member = next(name for name in bundle.namelist() if name.endswith(item["archive_member"]))
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.open(member) as source, destination.open("wb") as output:
                        shutil.copyfileobj(source, output)
        else:
            download(item["url"], destination)

    license_path = LICENSE_DIR / f"{Path(item['file']).stem}-OFL-1.1.txt"
    if not license_path.exists():
        download(item["license"], license_path)


def main() -> None:
    for font in FONTS:
        prepare_font(font)
    print(f"Local font library ready: {len(FONTS)} fonts", flush=True)


if __name__ == "__main__":
    main()
