# Face-centering map for test3 covers (Arthur 2026-07-05).
# Open-source mini-NN (MediaPipe BlazeFace) in GH Actions: for every cover image
# on the home page, detect faces and emit object-position percentages so CSS
# `object-fit:cover` crops around the FACES, not the geometric center.
# Output: faces.json {"<path>": "X% Y%"} — served to the edge worker via GH release.
import json, re, sys, urllib.request

import cv2
import numpy as np

COOKIE = 'svic_token=edge-preview'
HOME = 'https://test.siliconvalleyinvestclub.com/'

def fetch(url, binary=False):
    req = urllib.request.Request(url, headers={'Cookie': COOKIE, 'User-Agent': 'svic-faces/1'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read() if binary else r.read().decode('utf-8', 'ignore')

html = fetch(HOME)
# home covers (dedup by path, strip query)
paths = set(re.findall(r'i0\.wp\.com/(siliconvalleyinvestclub\.com/wp-content/uploads/[^"?\s]+\.(?:jpg|jpeg|png|webp))', html))
# + the FULL archive via REST featured-media (Load More reaches the earliest post)
page = 1
while True:
    try:
        js = json.loads(fetch(HOME.rstrip('/') + f'/wp-json/wp/v2/posts?per_page=100&page={page}&_embed=wp:featuredmedia&_fields=id,_links,_embedded'))
    except Exception as e:
        print('rest stop', page, str(e)[:60], file=sys.stderr); break
    if not isinstance(js, list) or not js: break
    for post in js:
        try:
            src = post['_embedded']['wp:featuredmedia'][0]['source_url']
            m = re.search(r'(siliconvalleyinvestclub\.com/wp-content/uploads/[^"?\s]+\.(?:jpg|jpeg|png|webp))', src, re.I)
            if m: paths.add(m.group(1))
        except Exception: pass
    if len(js) < 100: break
    page += 1
paths = sorted(paths)
print('covers found (home+archive):', len(paths))

# YuNet (opencv_zoo, Apache-2.0) — compact open face detector, single onnx file
MODEL = 'face_detection_yunet_2023mar.onnx'
urllib.request.urlretrieve('https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx', MODEL)
det = cv2.FaceDetectorYN_create(MODEL, '', (320, 320), score_threshold=0.6)
out = {}
for p in paths:
    try:
        # Photon 404s from GH-runner IPs — pull originals through our own edge (cookie'd)
        raw = fetch('https://test.siliconvalleyinvestclub.com/' + p.split('siliconvalleyinvestclub.com/',1)[1], binary=True)
        img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if img is None: continue
        if img.shape[1] > 900:
            sc = 900 / img.shape[1]
            img = cv2.resize(img, (900, int(img.shape[0] * sc)))
        h, w = img.shape[:2]
        det.setInputSize((w, h))
        ok, faces = det.detect(img)
        if faces is None or len(faces) == 0: continue
        # weighted center of all faces (weight = bbox area) + face extent + spread
        cx = cy = tw = 0.0; top = 1.0; fhmax = 0.0
        gleft = 1.0; gright = 0.0; best = None; barea = 0.0
        for f in faces:
            fx, fy, fw, fh = f[0], f[1], f[2], f[3]
            area = max(fw * fh, 1e-6)
            cx += (fx + fw / 2) / w * area
            cy += (fy + fh / 2) / h * area
            tw += area
            top = min(top, fy / h); fhmax = max(fhmax, fh / h)
            gleft = min(gleft, fx / w); gright = max(gright, (fx + fw) / w)
            if area > barea: barea = area; best = ((fx + fw / 2) / w, (fy + fh / 2) / h)
        # v5 (claroty case, Arthur 07-05): не «прыгать на крупнейшее лицо», а выбрать
        # ПЛОТНЕЙШЕЕ ОКНО — позицию кропа шириной самого узкого кадра (1:1 видит h/w),
        # покрывающую максимум суммарной площади лиц (частичное покрытие — пропорц.).
        # Трио claroty целиком в центре-окне; Render (двое по краям, оба не влезают)
        # автоматически сводится к крупнейшему лицу.
        vis = min(1.0, h / w)
        if (gright - gleft) > vis * 0.92:
            flist = []
            for f in faces:
                l = f[0] / w; r = (f[0] + f[2]) / w
                flist.append((l, r, max((f[2] / w) * (f[3] / h), 1e-6),
                              (f[0] + f[2] / 2) / w, (f[1] + f[3] / 2) / h))
            def coverage(c):
                wl, wr = c - vis / 2, c + vis / 2
                cov = ncx = ncy = nw = 0.0
                for l, r, a, fcx, fcy in flist:
                    inter = max(0.0, min(r, wr) - max(l, wl))
                    frac = inter / max(r - l, 1e-6)
                    cov += a * frac
                    if frac > 0.5: ncx += fcx * a; ncy += fcy * a; nw += a
                return cov, ncx, ncy, nw
            half = vis / 2
            cands = sorted(set([min(max(fc, half), 1 - half) for _, _, _, fc, _ in flist] + [min(max(cx / tw, half), 1 - half)]))
            bestc = None; bestcov = -1.0
            for c in cands:
                cov, ncx, ncy, nw = coverage(c)
                if cov > bestcov + 1e-9 or (abs(cov - bestcov) <= 1e-9 and bestc is not None and abs(c - cx / tw) < abs(bestc[0] - cx / tw)):
                    bestcov = cov; bestc = (c, ncx, ncy, nw)
            if bestc and bestc[3] > 0:
                cx, tw = bestc[0], 1.0
                cy = bestc[2] / bestc[3]
        fx = round(100 * cx / tw); fy = round(100 * cy / tw)
        top = round(100 * top); fh = round(100 * fhmax)
        # crop rule v3 (Nyobolt case, Arthur 07-05): (1) horizontally keep the
        # face-group point; (2) vertical thirds-lift ONLY when the face is small
        # (<35% of frame) — tight head-shots keep the face CENTERED (fy), no lift,
        # never crop the forehead harder than the original; (3) clamp.
        lift = 6 if fh < 35 else 0
        x = min(95, max(5, fx)); y = min(85, max(5, fy - lift))
        out[p] = {'pos': f'{x}% {y}%', 'f': [fx, fy], 'top': top, 'fh': fh}
    except Exception as e:
        print('skip', p, str(e)[:80], file=sys.stderr)

json.dump(out, open('faces.json', 'w'), ensure_ascii=False, indent=0)
print('faces.json entries:', len(out))
