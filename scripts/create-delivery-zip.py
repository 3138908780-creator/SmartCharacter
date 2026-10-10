"""Create portable UTF-8 ZIP names and preserve Mac entry executable permissions."""
from pathlib import Path
import sys
import stat
import shutil
import zipfile

source = Path(sys.argv[1]).resolve()
archive = Path(sys.argv[2]).resolve()
partial = Path(str(archive) + '.partial')
try:
    with zipfile.ZipFile(partial, 'w', allowZip64=True) as z:
        for path in sorted(source.rglob('*')):
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode):
                raise RuntimeError('Delivery cannot contain dependency symlinks')
            if not path.is_file():
                continue
            name = path.relative_to(source.parent).as_posix()
            info = zipfile.ZipInfo(name, (2026, 10, 9, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (mode & 0xFFFF) << 16
            info.compress_type = zipfile.ZIP_STORED if path.suffix.lower() in {'.gz', '.zip', '.woff2', '.png'} else zipfile.ZIP_DEFLATED
            with path.open('rb') as original, z.open(info, 'w', force_zip64=True) as output:
                shutil.copyfileobj(original, output, 1024 * 1024)
    partial.replace(archive)
except BaseException:
    partial.unlink(missing_ok=True)
    raise
