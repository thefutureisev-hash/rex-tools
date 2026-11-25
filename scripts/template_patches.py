"""
Makes image patches that hide placeholder text on the Canva quotation template.

Usage: python3 -I scripts/template_patches.py <page.png rendered at 300 dpi> <out_dir> <regions.json>

regions.json: [{"name": "pill", "box": [x0, y0, x1, y1]}, ...] in PDF points from the
top-left corner. Each region is filled by extending the pixels just left of it
across every row, which keeps flat fills and horizontal edges (card borders)
intact. Writes <name>.png for each region.
"""
import json
import sys

from PIL import Image

DPI = 300
K = DPI / 72


def main(page_png: str, out_dir: str, regions_json: str) -> None:
    im = Image.open(page_png).convert('RGB')
    for r in json.load(open(regions_json)):
        x0, y0, x1, y1 = (int(round(v * K)) for v in r['box'])
        patch = Image.new('RGB', (x1 - x0, y1 - y0))
        src = im.load()
        dst = patch.load()
        for y in range(y0, y1):
            fill = src[x0 - 2, y]
            for x in range(x0, x1):
                dst[x - x0, y - y0] = fill
        patch.save(f"{out_dir}/{r['name']}.png")
        print(r['name'], patch.size)


if __name__ == '__main__':
    main(*sys.argv[1:4])
