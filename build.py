#!/usr/bin/env python3
"""
把 SlideGrid 打包成一个独立的 HTML 文件（离线双击即可使用）。

    python3 build.py                 # 输出 dist/SlideGrid.html 和根目录的 SlideGrid.html
    python3 build.py -o 路径.html    # 只输出到指定路径
    python3 build.py --check         # 检查根目录的 SlideGrid.html 是否和源码一致（不一致时退出码为 1）

输出只由源码决定（文件头记录源码的哈希，不记录时间），源码没变时重新构建得到完全相同的文件。

做法：每个 JS 模块转成 data: URL，用 import map 把模块路径映射过去；
模块内部的相对导入改写成同一套模块名。源码不需要任何改动，模块之间的关系原样保留。
CSS 直接内联。只用 Python 标准库。
"""
import argparse
import base64
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PREFIX = 'slidegrid/'  # 模块名前缀（裸模块名，由 import map 解析）

# import ... from './x.js'、export ... from './x.js'、import './x.js'
SPEC = re.compile(r"""(\bfrom\s*|\bimport\s*)(['"])(\.{1,2}/[^'"]+)\2""")


def module_name(path: Path) -> str:
    return PREFIX + path.relative_to(ROOT).as_posix()


def rewrite(path: Path) -> str:
    src = path.read_text(encoding='utf-8')

    def repl(m):
        target = (path.parent / m.group(3)).resolve()
        if not target.is_file():
            raise SystemExit(f'找不到模块：{m.group(3)}（在 {path.relative_to(ROOT)} 中）')
        return f'{m.group(1)}{m.group(2)}{module_name(target)}{m.group(2)}'

    return SPEC.sub(repl, src)


def collect(entry: Path) -> dict:
    """从入口出发收集所有用到的模块（没用到的文件不打包）。"""
    modules, todo = {}, [entry]
    while todo:
        path = todo.pop()
        name = module_name(path)
        if name in modules:
            continue
        code = rewrite(path)
        modules[name] = code
        for m in SPEC.finditer(path.read_text(encoding='utf-8')):
            todo.append((path.parent / m.group(3)).resolve())
    return modules


def data_url(code: str) -> str:
    return 'data:text/javascript;base64,' + base64.b64encode(code.encode('utf-8')).decode('ascii')


def render() -> tuple:
    """生成单文件 HTML 的内容，返回 (html, 模块数)。"""
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    css = (ROOT / 'css/style.css').read_text(encoding='utf-8')
    entry = ROOT / 'js/main.js'
    modules = collect(entry)
    imports = {name: data_url(code) for name, code in sorted(modules.items())}
    importmap = json.dumps({'imports': imports}, ensure_ascii=False)

    link = '<link rel="stylesheet" href="css/style.css">'
    script = '<script type="module" src="js/main.js"></script>'
    for tag in (link, script):
        if tag not in html:
            raise SystemExit(f'index.html 里找不到：{tag}')

    license_text = (ROOT / 'licenses/lucide-LICENSE.txt').read_text(encoding='utf-8').replace('--', '- -')
    stamp = hashlib.sha256((html + css + importmap).encode('utf-8')).hexdigest()[:12]
    html = html.replace(link, f'<style>\n{css}\n</style>')
    html = html.replace(script,
        f'<script type="importmap">{importmap}</script>\n'
        f'  <script type="module">import {json.dumps(module_name(entry))};</script>')
    charset = '<meta charset="utf-8">'  # 必须在文件前 1024 字节内，注释放在它后面
    html = html.replace(charset, f'{charset}\n  <!-- SlideGrid 单文件版 · 源码 {stamp} · 由 build.py 生成，请勿直接修改 -->\n'
                                  f'  <!-- 图标来自 Lucide（ISC 许可）：\n{license_text}\n  -->', 1)

    return html, len(modules)


def write(out: Path, html: str, count: int) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding='utf-8')
    print(f'已生成 {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}：'
          f'{count} 个模块，{out.stat().st_size / 1024:.0f} KB')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='把 SlideGrid 打包成单个 HTML 文件')
    ap.add_argument('-o', '--out', help='输出路径（默认 dist/SlideGrid.html 和根目录的 SlideGrid.html）')
    ap.add_argument('--check', action='store_true', help='只检查根目录的 SlideGrid.html 是否是最新的')
    args = ap.parse_args()
    html, count = render()
    if args.check:
        root = ROOT / 'SlideGrid.html'
        ok = root.is_file() and root.read_text(encoding='utf-8') == html
        print('SlideGrid.html 是最新的' if ok else 'SlideGrid.html 不是最新的，请运行 python3 build.py')
        raise SystemExit(0 if ok else 1)
    for out in ([Path(args.out).resolve()] if args.out else [ROOT / 'dist/SlideGrid.html', ROOT / 'SlideGrid.html']):
        write(out, html, count)
