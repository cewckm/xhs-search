# tojpg.py — transcode WebP/AVIF to real JPEG for Word embedding.
# Usage: python tojpg.py <src> <dst>
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
with Image.open(src) as im:
    im = im.convert("RGB")
    im.thumbnail((1400, 2000))
    im.save(dst, "JPEG", quality=86)
print("converted", dst)
