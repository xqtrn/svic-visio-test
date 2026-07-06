# Face-centering map for test3 covers (Arthur 2026-07-05).
# Open-source mini-NN (MediaPipe BlazeFace) in GH Actions: for every cover image
# on the home page, detect faces and emit object-position percentages so CSS
# `object-fit:cover` crops around the FACES, not the geometric center.
# Output: faces.json {"<path>": "X% Y%"} — served to the edge worker via GH release.
import json, re, sys, urllib.request

import cv2
import numpy as np
import mediapipe as mp

COOKIE = 'svic_token=edge-preview'
HOME = 'https://test3.siliconvalleyinvestclub.com/'

def fetch(url, binary=False):
    req = urllib.request.Request(url, headers={'Cookie': COOKIE, 'User-Agent': 'svic-faces/1'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read() if binary else r.read().decode('utf-8', 'ignore')

html = fetch(HOME)
# all upload covers (dedup by path, strip query)
paths = sorted(set(re.findall(r'i0\.wp\.com/(siliconvalleyinvestclub\.com/wp-content/uploads/[^"?\s]+\.(?:jpg|jpeg|png|webp))', html)))
print('covers found:', len(paths))

det = mp.solutions.face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.5)
out = {}
for p in paths:
    try:
        raw = fetch('https://i0.wp.com/' + p + '?resize=800%2C800&ssl=1', binary=True)
        img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if img is None: continue
        h, w = img.shape[:2]
        res = det.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        if not res.detections: continue
        # weighted center of all faces (weight = bbox area)
        cx = cy = tw = 0.0
        for d in res.detections:
            bb = d.location_data.relative_bounding_box
            area = max(bb.width * bb.height, 1e-6)
            cx += (bb.xmin + bb.width / 2) * area
            cy += (bb.ymin + bb.height / 2) * area
            tw += area
        x = round(100 * cx / tw); y = round(100 * cy / tw)
        x = min(95, max(5, x)); y = min(90, max(5, y))
        # only store when meaningfully off-center (else default is fine)
        if abs(x - 50) >= 8 or abs(y - 50) >= 8:
            out[p] = f'{x}% {y}%'
    except Exception as e:
        print('skip', p, str(e)[:80], file=sys.stderr)

json.dump(out, open('faces.json', 'w'), ensure_ascii=False, indent=0)
print('faces.json entries:', len(out))
