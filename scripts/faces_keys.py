"""Which site images the faces robot scans, and under which key the site looks them up.

The map key format belongs to the site worker (testnew-edge/smartcrop.mjs): every
storage root (/img, /svic-media, /e/uploads, /wp-content/uploads) reads one key,
"siliconvalleyinvestclub.com/wp-content/uploads/<rest>". A file with a different
key is simply never centred.
"""
from __future__ import annotations

import re
import urllib.parse

KEY_PREFIX = 'siliconvalleyinvestclub.com/wp-content/uploads/'
ROOTS = ('/svic-media/', '/img/', '/e/uploads/', '/wp-content/uploads/')
RASTER = re.compile(r'\.(?:jpe?g|png|webp)$', re.I)
SITE_HOST = re.compile(r'^https?://(?:[a-z0-9-]+\.)*siliconvalleyinvestclub\.com(?=/)', re.I)
HTML_SRC = re.compile(r'''["'(,\s](/(?:svic-media|img|e/uploads|wp-content/uploads)/[^"'?\s&,)]+)''', re.I)


def cover_path(src):
    """Site path of an image, or None when it is not one of our raster covers."""
    path = SITE_HOST.sub('', str(src or '').strip())
    path = path.split('#', 1)[0].split('?', 1)[0]
    if not path.startswith(ROOTS) or not RASTER.search(path):
        return None
    return path


def face_key(path):
    for root in ROOTS:
        if path.startswith(root):
            return KEY_PREFIX + urllib.parse.unquote(path[len(root):])
    return None


def paths_from_html(html):
    found = (cover_path(m) for m in HTML_SRC.findall(html or ''))
    return {p for p in found if p}


def paths_from_posts(posts):
    found = (cover_path((p or {}).get('image')) for p in posts or [])
    return {p for p in found if p}


def to_scan(paths, known):
    """One path per key, skipping keys already in the map or already seen without a face."""
    todo = {}
    for path in sorted(paths):
        key = face_key(path)
        if key and key not in known and key not in todo:
            todo[key] = path
    return todo
