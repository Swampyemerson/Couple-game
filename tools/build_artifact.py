#!/usr/bin/env python3
"""Bundle the app into one self-contained HTML page for a Claude artifact.

    python3 tools/build_artifact.py   ->  dist/just-us.html

Inlines the CSS and the JS modules (imports/exports stripped, wrapped in one
scope) and turns on artifact mode, which syncs through the artifact's shared
database instead of Firebase / sync links.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODULES = ['js/config.js', 'js/content.js', 'js/store.js', 'js/app.js']


def strip_module(src: str) -> str:
    src = re.sub(r"^import\s[\s\S]*?from\s+'[^']+';\n", '', src, flags=re.M)
    src = re.sub(r'^export\s+', '', src, flags=re.M)
    return src


def main() -> None:
    js = '\n'.join(f'// ── {m} ──\n' + strip_module((ROOT / m).read_text()) for m in MODULES)
    assert 'import ' not in re.sub(r'import\(', '', js).split('// ── js/store.js')[0], 'stray import'
    css = (ROOT / 'style.css').read_text()
    # The artifact frame already pads :root by the safe-area insets.
    css += '\n.topbar { top: env(safe-area-inset-top, 0px); padding-top: 10px; }\n'
    html = f"""<title>Just Us</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800;900&display=swap" rel="stylesheet">
<style>
{css}
</style>
<main id="app"></main>
<script>
globalThis.JUST_US_ARTIFACT = true;
(() => {{
{js}
}})();
</script>
"""
    out = ROOT / 'dist' / 'just-us.html'
    out.parent.mkdir(exist_ok=True)
    out.write_text(html)
    print(f'wrote {out.relative_to(ROOT)} ({len(html) // 1024} KB)')


if __name__ == '__main__':
    main()
