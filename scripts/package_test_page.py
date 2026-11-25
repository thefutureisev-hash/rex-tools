"""
Turns dist-static/index.html (from `npm run build:static`) into the page body the
claude.ai artifact publisher expects: title, font link, styles, body and scripts,
with no document skeleton. U+FFFD characters inside scripts are written as \\ufffd
escapes, which the publisher requires.

Usage: python3 -I scripts/package_test_page.py dist-static/index.html <out.html>
"""
import re
import sys

src, out = sys.argv[1], sys.argv[2]
html = open(src, encoding='utf-8').read()
head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
styles = ''.join(re.findall(r'<style[^>]*>.*?</style>', head, re.S))
scripts = ''.join(re.findall(r'<script[^>]*>.*?</script>', head, re.S)).replace('�', '\\ufffd')
page = (
    '<title>Rexperts Quote Builder</title>\n'
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">\n'
    + styles + '\n' + body + '\n' + scripts + '\n'
)
open(out, 'w', encoding='utf-8').write(page)
print(f'Wrote {out} ({len(page.encode()):,} bytes)')
