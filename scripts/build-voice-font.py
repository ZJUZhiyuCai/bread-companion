"""Build renamed, unicode-ranged WOFF2 subsets from the OFL-licensed upstream TTF.

Usage: python3 scripts/build-voice-font.py /path/LXGWWenKaiScreen.ttf /path/OFL.txt
Requires fonttools[woff] and brotli. Source downloads and licenses are documented in docs/fonts.md.
"""
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor
from hashlib import sha256
import json
import sys
from fontTools.ttLib import TTFont
from fontTools import subset

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'public/design/fonts'

def ranges(points):
    result = []
    for cp in sorted(points):
        if result and cp == result[-1][1] + 1:
            result[-1][1] = cp
        else:
            result.append([cp, cp])
    return ','.join(f'U+{a:X}' + (f'-{b:X}' if a != b else '') for a, b in result)

def build(job):
    source, label, points = job
    font = TTFont(source, recalcTimestamp=False)
    options = subset.Options()
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.name_legacy = True
    worker = subset.Subsetter(options=options)
    worker.populate(unicodes=points)
    worker.subset(font)
    # A subset is a modified font. Preserve copyright/license and use a new family/name.
    names = {1: 'Bread Voice', 2: 'Regular', 3: 'BreadVoiceSubset-1.530-' + label,
             4: 'Bread Voice Regular', 6: 'BreadVoiceSubset-' + label, 16: 'Bread Voice', 17: 'Regular'}
    for entry in font['name'].names:
        if entry.nameID in names:
            entry.string = names[entry.nameID].encode(entry.getEncoding(), errors='replace')
    font.flavor = 'woff2'
    import io
    output = io.BytesIO()
    font.save(output)
    actual = set(font.getBestCmap())
    assert set(points).issubset(actual), label
    font.close()
    data = output.getvalue()
    digest = sha256(data).hexdigest()
    filename = f'bread-voice-{label}-{digest[:12]}.woff2'
    (DEST / filename).write_bytes(data)
    return {'file': filename, 'bytes': len(data), 'sha256': digest, 'unicodeRange': ranges(points), 'glyphs': len(points)}

def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    source, license_path = map(Path, sys.argv[1:])
    font = TTFont(source, lazy=True)
    all_points = set(font.getBestCmap())
    font.close()
    core = set(range(0x20, 0x100))
    for folder in ['app', 'components', 'domain']:
        for file in (ROOT / folder).rglob('*'):
            if file.suffix in ['.tsx', '.ts']:
                core.update(map(ord, file.read_text()))
    core &= all_points
    source_hash = sha256(source.read_bytes()).hexdigest()
    core_hash = sha256(json.dumps(sorted(core)).encode()).hexdigest()
    DEST.mkdir(parents=True, exist_ok=True)
    manifest_path = DEST / 'manifest.json'
    if manifest_path.exists():
        old = json.loads(manifest_path.read_text())
        if old.get('sourceSha256') == source_hash and old.get('coreSha256') == core_hash and all((DEST / f['file']).is_file() and sha256((DEST / f['file']).read_bytes()).hexdigest() == f['sha256'] for f in old['subsets']):
            print('Unchanged verified font subsets; no rebuild needed.')
            return
    jobs = [(str(source), 'core', sorted(core))]
    remaining = sorted(all_points - core)
    for start in range(0, len(remaining), 512):
        jobs.append((str(source), f'{start // 512:03d}', remaining[start:start + 512]))
    with ProcessPoolExecutor(max_workers=2) as executor:
        records = list(executor.map(build, jobs))
    (DEST / 'OFL-LXGW.txt').write_bytes(license_path.read_bytes())
    css = '/* LXGW WenKai Screen 1.530, renamed/subset under SIL OFL 1.1; see OFL-LXGW.txt. */\n'
    for record in records:
        css += "@font-face { font-family: 'Bread Voice'; font-style: normal; font-weight: 400; font-display: swap; " + f"src: url('/design/fonts/{record['file']}') format('woff2'); unicode-range: {record['unicodeRange']}; }}\n"
    (DEST / 'fonts.css').write_text(css)
    manifest = {'upstream': 'https://github.com/lxgw/LxgwWenKai-Screen/releases/tag/v1.530', 'sourceFile': 'LXGWWenKaiScreen.ttf', 'sourceSha256': source_hash, 'coreSha256': core_hash, 'license': 'OFL-1.1', 'modifiedFamily': 'Bread Voice', 'coreHref': '/design/fonts/' + records[0]['file'], 'coverage': len(all_points), 'subsets': records}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'subsets': len(records), 'coverage': len(all_points), 'coreBytes': records[0]['bytes'], 'totalBytes': sum(r['bytes'] for r in records), 'coreHref': manifest['coreHref']}))

if __name__ == '__main__':
    main()
