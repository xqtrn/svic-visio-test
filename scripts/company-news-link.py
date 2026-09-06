#!/usr/bin/env python3
"""Unwrap publisher URLs from Bing/Google news RSS links.

Bing RSS puts the real article behind apiclick.aspx?url=. The XML encodes
that ampersand as `&amp;url=`. Looking for `&url=` on the raw string drops
every Bing item, the ≥8 publication floor never sees them, and a thin
release asset freezes forever (Corgi Insurance, 2026-09-06: 0 direct-link
items, retained feed stuck at 5 since 2026-08-13).
"""
from __future__ import annotations

import html
import re
import urllib.parse

AGG = re.compile(
    r'news\.google\.com/(rss/)?articles|bing\.com/news/apiclick|apiclick\.aspx',
    re.I,
)


def direct_link(link: str) -> str:
    link = html.unescape(str(link or '')).strip()
    if not link:
        return ''
    if 'bing.com' in link.lower():
        hit = re.search(r'[?&]url=([^&]+)', link)
        if hit:
            link = urllib.parse.unquote(hit.group(1)).strip()
    if not link or AGG.search(link):
        return ''
    return link


def merge_items(fresh: list, retained: list, cap: int = 40) -> list:
    out, seen = [], set()
    for row in list(fresh or []) + list(retained or []):
        if not row:
            continue
        link = direct_link(row.get('link') or '')
        title = str(row.get('title') or '').strip()
        if not link or not title:
            continue
        key = re.sub(r'\W+', ' ', title.lower()).strip()[:80]
        if not key or key in seen:
            continue
        seen.add(key)
        item = dict(row)
        item['link'] = link
        out.append(item)
    out.sort(key=lambda item: -int(item.get('ts') or 0))
    return out[:cap]
