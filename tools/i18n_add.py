#!/usr/bin/env python3
"""往语言文件里加条目（已有的原文会被更新）。从标准输入读，每两行一条：第一行原文，第二行译文（⏎ 代表换行）。

    python3 tools/i18n_add.py [语言代码，默认 en] < 条目.txt
"""
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape

code = sys.argv[1] if len(sys.argv) > 1 else 'en'
path = Path(__file__).resolve().parent.parent / 'lang' / f'{code}.xml'
text = path.read_text(encoding='utf-8')
q = lambda s: escape(s, {'"': '&quot;', '\n': '&#10;'})
lines = [l.rstrip('\n') for l in sys.stdin if l.strip()]
added = 0
for k, v in zip(lines[0::2], lines[1::2]):
    k, v = k.replace('⏎', '\n'), v.replace('⏎', '\n')
    entry = f'  <s k="{q(k)}">{escape(v)}</s>'
    pat = re.compile(r'^  <s k="' + re.escape(q(k)) + r'">.*?</s>$', re.M | re.S)
    if pat.search(text):
        text = pat.sub(lambda m: entry, text, count=1)
    else:
        text = text.replace('</language>', entry + '\n</language>')
    added += 1
path.write_text(text, encoding='utf-8')
print(f'{path.name}：写入 {added} 条')
