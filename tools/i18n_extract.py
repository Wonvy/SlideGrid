#!/usr/bin/env python3
"""
找出界面里所有的中文文字（js/ 里的字符串、index.html 里的文字和提示），和语言文件对照。

    python3 tools/i18n_extract.py                # 列出 lang/en.xml 里还没有翻译的文字
    python3 tools/i18n_extract.py --all          # 列出全部文字（每行一条）
    python3 tools/i18n_extract.py --check        # 有没翻译的就以退出码 1 结束（测试里用）
    python3 tools/i18n_extract.py --lang ja      # 对照 lang/ja.xml
    python3 tools/i18n_extract.py --template     # 输出一份空白的语言文件（所有文字，译文留空），给翻译新语言用

规则和 js/i18n/i18n.js 一致：
  - 普通字符串：原文就是键
  - 模板字符串里的 ${...} 记成 {0}、{1}…（译文里用同样的占位符，顺序可以调）
  - 注释里的中文不算；只含标点、数字的不算
"""
import argparse
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
CJK = re.compile(r'[一-鿿]')


def js_strings(text: str):
    """依次产出 JS 源码里的字符串（注释、正则不算）。模板字符串里的 ${…} 换成 {n}；${…} 里面的字符串也会单独产出。"""
    out = []
    n = len(text)
    REGEX_PREV = set('(,=:[!&|?{};+-*%<>~^') | {'', 'return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'void'}

    def template(i):
        # i 指向开头反引号的后一位。返回结束位置；内容记进 out
        buf, k = '', 0
        while i < n:
            c = text[i]
            if c == '\\':
                nxt = text[i + 1] if i + 1 < n else ''
                buf += {'n': '\n', 't': '\t'}.get(nxt, nxt)
                i += 2
            elif c == '`':
                out.append(buf)
                return i + 1
            elif c == '$' and i + 1 < n and text[i + 1] == '{':
                i = code(i + 2, True)
                buf += '{%d}' % k
                k += 1
            else:
                buf += c
                i += 1
        out.append(buf)
        return i

    def code(i, until_brace=False):
        # 扫一段代码；until_brace：遇到配对的 } 就结束（${…} 里面）。返回结束位置
        depth = 0
        prev = ''  # 上一个有意义的记号：用来判断 / 是除号还是正则的开头
        while i < n:
            c = text[i]
            if text.startswith('//', i):
                j = text.find('\n', i)
                i = n if j < 0 else j
            elif text.startswith('/*', i):
                j = text.find('*/', i + 2)
                i = n if j < 0 else j + 2
            elif c in '\'"':
                j, buf = i + 1, ''
                while j < n and text[j] != c and text[j] != '\n':
                    if text[j] == '\\':
                        nxt = text[j + 1] if j + 1 < n else ''
                        buf += {'n': '\n', 't': '\t'}.get(nxt, nxt)
                        j += 2
                    else:
                        buf += text[j]
                        j += 1
                out.append(buf)
                i = j + 1
                prev = 'x'
            elif c == '`':
                i = template(i + 1)
                prev = 'x'
            elif c == '/' and prev in REGEX_PREV:
                j, in_class = i + 1, False
                while j < n and (text[j] != '/' or in_class) and text[j] != '\n':
                    if text[j] == '\\':
                        j += 1
                    elif text[j] == '[':
                        in_class = True
                    elif text[j] == ']':
                        in_class = False
                    j += 1
                i = j + 1
                while i < n and text[i].isalpha():
                    i += 1
                prev = 'x'
            elif c == '{':
                depth += 1
                prev = c
                i += 1
            elif c == '}':
                if until_brace and depth == 0:
                    return i + 1
                depth -= 1
                prev = c
                i += 1
            elif c.isalpha() or c in '_$':
                j = i
                while j < n and (text[j].isalnum() or text[j] in '_$'):
                    j += 1
                prev = text[i:j]
                i = j
            else:
                if not c.isspace():
                    prev = c
                i += 1
        return i

    code(0)
    return out


class HtmlText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.items, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        for k, v in attrs:
            if k in ('title', 'placeholder', 'aria-label', 'alt') and v:
                self.items.append(v)

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip and data.strip():
            self.items.append(data.strip())


def collect():
    """返回 {文字: [出现的文件…]}，按第一次出现的顺序。"""
    found = {}
    # 着色器源码里的中文是注释，vendor 是第三方代码：都不算界面文字
    files = [ROOT / 'index.html'] + [f for f in sorted((ROOT / 'js').rglob('*.js')) if f.name != 'shaders.js' and 'vendor' not in f.parts]
    for path in files:
        rel = path.relative_to(ROOT).as_posix()
        if path.suffix == '.html':
            h = HtmlText()
            h.feed(path.read_text(encoding='utf-8'))
            strings = h.items
        else:
            strings = js_strings(path.read_text(encoding='utf-8'))
        for s in strings:
            s = s.strip()
            if not CJK.search(s):
                continue
            found.setdefault(s, [])
            if rel not in found[s]:
                found[s].append(rel)
    return found


def load_lang(code):
    path = ROOT / 'lang' / f'{code}.xml'
    if not path.is_file():
        return {}
    import xml.etree.ElementTree as ET
    root = ET.parse(path).getroot()
    return {el.get('k'): (el.text or '') for el in root.iter('s')}


def main():
    ap = argparse.ArgumentParser(description='找出界面里要翻译的中文文字')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--template', action='store_true')
    ap.add_argument('--lang', default='en')
    args = ap.parse_args()
    found = collect()
    if args.template:
        print('<?xml version="1.0" encoding="UTF-8"?>')
        print('<language code="xx" name="语言名称">')
        for s in found:
            print(f'  <s k="{escape(s, {chr(34): "&quot;", chr(10): "&#10;"})}"></s>')
        print('</language>')
        return
    if args.all:
        for s, files in found.items():
            print(repr(s), files[0])
        print(f'\n共 {len(found)} 条', file=sys.stderr)
        return
    have = load_lang(args.lang)
    missing = [s for s in found if not have.get(s)]
    unused = [k for k in have if k not in found]
    for s in missing:
        print(repr(s), found[s][0])
    print(f'\n共 {len(found)} 条，lang/{args.lang}.xml 里已翻译 {len(found) - len(missing)} 条，缺 {len(missing)} 条；语言文件里多出来（源码里已经没有）的 {len(unused)} 条', file=sys.stderr)
    if args.check and missing:
        sys.exit(1)


if __name__ == '__main__':
    main()
