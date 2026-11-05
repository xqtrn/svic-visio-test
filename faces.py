# Face-centering map for test3 covers (Arthur 2026-07-05).
# Open-source mini-NN (MediaPipe BlazeFace) in GH Actions: for every cover image
# on the home page, detect faces and emit object-position percentages so CSS
# `object-fit:cover` crops around the FACES, not the geometric center.
# Output: faces.json {"<path>": "X% Y%"} — served to the edge worker via GH release.
import json, os, sys, time, urllib.error, urllib.parse, urllib.request

import cv2
import numpy as np

sys.path.insert(0, 'scripts')
import faces_keys as keys

SITE = os.environ.get('SVIC_SITE', 'https://siliconvalleyinvestclub.com').rstrip('/')
RELEASE = 'https://github.com/xqtrn/svic-visio-test/releases/download/faces/'
SCAN_SECONDS = 45 * 60   # the rest waits for next week's run; the job limit is 60 minutes

def fetch(url, binary=False):
    req = urllib.request.Request(url, headers={'User-Agent': 'svic-faces/1'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read() if binary else r.read().decode('utf-8', 'ignore')

def published(name, required):
    try:
        return json.loads(fetch(RELEASE + name))
    except urllib.error.HTTPError as e:
        if e.code == 404 and not required: return None
        raise

# Covers come from the public site: the home page plus every post the site lists.
# The robot used to read test.* (behind login since 2026-08-03) and WordPress REST
# (gone), so nothing published after 2026-07-27 got a face map.
paths = keys.paths_from_html(fetch(SITE + '/'))
offset = 0
while True:
    posts = json.loads(fetch(f'{SITE}/api/site/posts?limit=50&offset={offset}')).get('posts') or []
    paths |= keys.paths_from_posts(posts)
    offset += len(posts)
    if len(posts) < 50: break
print('covers on the site:', len(paths))
if not paths:
    sys.exit('the site returned no covers: refusing to publish from a blind read')

# The published map is kept and only new covers are scanned, so a bad read can
# never shrink it. Covers already scanned without a face are remembered separately:
# the site reads any entry in faces.json as a face.
out = published('faces.json', True)
no_face = set(published('faces-seen.json', False) or [])
todo = keys.to_scan(paths, set(out) | no_face)
print('already mapped:', len(out), '| seen without a face:', len(no_face), '| to scan:', len(todo))
started = time.monotonic()
scanned = failed = found = 0

# YuNet (opencv_zoo, Apache-2.0) — compact open face detector, single onnx file
MODEL = 'face_detection_yunet_2023mar.onnx'
urllib.request.urlretrieve('https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx', MODEL)
det = cv2.FaceDetectorYN_create(MODEL, '', (320, 320), score_threshold=0.6)
for p, path in todo.items():
    if time.monotonic() - started > SCAN_SECONDS:
        print('time limit: the rest waits for the next run,', len(todo) - scanned, 'left')
        break
    scanned += 1
    try:
        raw = fetch(SITE + urllib.parse.quote(path, safe='/%'), binary=True)
        img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            no_face.add(p)
            continue
        if img.shape[1] > 900:
            sc = 900 / img.shape[1]
            img = cv2.resize(img, (900, int(img.shape[0] * sc)))
        h, w = img.shape[:2]
        det.setInputSize((w, h))
        ok, faces = det.detect(img)
        if faces is None or len(faces) == 0:
            no_face.add(p)
            continue
        # weighted center of all faces (weight = bbox area) + face extent + spread
        cx = cy = tw = 0.0; top = 1.0; fhmax = 0.0; bot = 0.0
        gleft = 1.0; gright = 0.0; best = None; barea = 0.0
        for f in faces:
            fx, fy, fw, fh = f[0], f[1], f[2], f[3]
            area = max(fw * fh, 1e-6)
            cx += (fx + fw / 2) / w * area
            cy += (fy + fh / 2) / h * area
            tw += area
            top = min(top, fy / h); fhmax = max(fhmax, fh / h); bot = max(bot, (fy + fh) / h)
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
        top = round(100 * top); fh = round(100 * fhmax); bot = round(100 * bot); gl = round(100 * gleft); gr = round(100 * gright)
        # crop rule v3 (Nyobolt case, Arthur 07-05): (1) horizontally keep the
        # face-group point; (2) vertical thirds-lift ONLY when the face is small
        # (<35% of frame) — tight head-shots keep the face CENTERED (fy), no lift,
        # never crop the forehead harder than the original; (3) clamp.
        # v6 (Positron case, Arthur 07-12): ULTRA-tight portraits (face >=50% of
        # frame) in a wide 16:9 crop lose the forehead at centre — anchor the crop
        # to the EYE LINE (top + 38% of face height) so the forehead survives.
        lift = 6 if fh < 35 else 0
        y_anchor = fy - lift
        if fh >= 50:
            y_anchor = top + round(fh * 0.38)
        x = min(95, max(5, fx)); y = min(85, max(5, y_anchor))
        out[p] = {'pos': f'{x}% {y}%', 'f': [fx, fy], 'top': top, 'fh': fh, 'n': int(len(faces)), 'bot': bot, 'gl': gl, 'gr': gr, 'ar': round(1000 * w / h)}
        found += 1
    except Exception as e:
        failed += 1
        print('skip', p, str(e)[:80], file=sys.stderr)

print(f'scanned {scanned}: faces in {found}, failed {failed}')
if scanned and failed == scanned:
    sys.exit('every cover failed to load: the site is not answering this robot')
json.dump(out, open('faces.json', 'w'), ensure_ascii=False, indent=0)
json.dump(sorted(no_face), open('faces-seen.json', 'w'), ensure_ascii=False, indent=0)
print('faces.json entries:', len(out))
