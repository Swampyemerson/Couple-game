#!/usr/bin/env python3
"""Bundle the app into one self-contained HTML page for a Claude artifact.

    python3 tools/build_artifact.py   ->  dist/just-us.html

A tiny module bundler: every ES module becomes its own strict-mode function
scope, `import { a } from './x.js'` becomes a lookup in the module table, and
`export` declarations become the module's return value. Every js/games/*.js is
included automatically. Artifact mode syncs through the artifact's shared
database and room instead of Firebase / sync links.
"""
import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS_FILES = ['style.css', 'games.css']

IMPORT_RE = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*'([^']+)';[ \t]*\n", re.M)
SIDE_IMPORT_RE = re.compile(r"^import\s*'([^']+)';[ \t]*\n", re.M)
EXPORT_RE = re.compile(r"^export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)", re.M)


ENGINE = ('core.js', 'index.js', 'covers.js')


def module_order(only=None):
    games = sorted(p for p in (ROOT / 'js/games').glob('*.js') if p.name not in ENGINE)
    if only is not None:
        games = [p for p in games if p.stem in only]
    return ['js/config.js', 'js/content.js', 'js/store.js', 'js/games/covers.js', 'js/games/core.js'] + \
        [str(p.relative_to(ROOT)) for p in games] + ['js/app.js']


def resolve(frm: str, spec: str) -> str:
    return str((ROOT / frm).parent.joinpath(spec).resolve().relative_to(ROOT))


def bundle_module(path: str, known: set) -> str:
    src = (ROOT / path).read_text()

    def imp(m):
        names = [n.strip() for n in m.group(1).split(',') if n.strip()]
        target = resolve(path, m.group(2))
        if target not in known:
            raise SystemExit(f'{path}: imports {target}, which is not bundled before it')
        binds = ', '.join(n.replace(' as ', ': ') for n in names)
        return f"const {{ {binds} }} = __M['{target}'];\n"

    src = IMPORT_RE.sub(imp, src)
    src = SIDE_IMPORT_RE.sub('', src)
    if re.search(r"^\s*import\s", src, re.M):
        raise SystemExit(f'{path}: unsupported import form')
    exports = EXPORT_RE.findall(src)
    src = re.sub(r'^export\s+', '', src, flags=re.M)
    if re.search(r'^\s*export\b', src, re.M):
        raise SystemExit(f'{path}: unsupported export form')
    ret = ', '.join(exports)
    return f"// ── {path} ──\n__M['{path}'] = (() => {{\n'use strict';\n{src}\nreturn {{ {ret} }};\n}})();\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='comma-separated game file names (without .js) to include; default all')
    ap.add_argument('--out', default=str(ROOT / 'dist' / 'just-us.html'))
    args = ap.parse_args()
    only = set(x for x in args.only.split(',') if x) if args.only is not None else None
    order = module_order(only)
    known: set = set()
    parts = []
    for p in order:
        parts.append(bundle_module(p, known))
        known.add(p)
    js = '\n'.join(parts)
    # A literal "</script" inside the code would end the inline <script> early.
    js = re.sub(r'</(script)', r'<\\/\1', js, flags=re.I)
    css = '\n'.join((ROOT / f).read_text() for f in CSS_FILES if (ROOT / f).exists())
    # The artifact frame already pads :root by the safe-area insets.
    css += '\n.topbar { top: env(safe-area-inset-top, 0px); padding-top: 10px; }\n'
    fonts = (ROOT / 'tools/fonts.txt').read_text().strip() if (ROOT / 'tools/fonts.txt').exists() else \
        'family=Nunito:wght@600;700;800;900'
    html = f"""<title>Just Us</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?{fonts}&display=swap" rel="stylesheet">
<style>
{css}
</style>
<main id="app"></main>
<script>
globalThis.JUST_US_ARTIFACT = true;
(() => {{
const __M = Object.create(null);
{js}
}})();
</script>
"""
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix('.tmp')
    tmp.write_text(html)
    tmp.replace(out)  # atomic, so a parallel reader never sees half a file
    print(f'wrote {out} ({len(html) // 1024} KB, {len(order)} modules)')


if __name__ == '__main__':
    main()
