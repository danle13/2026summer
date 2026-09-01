# Rebuilding the stock face library

These three scripts produce everything in `../stock/`. You only need them if you
want to change which faces ship — the output is committed, so the app itself has
no build step.

```sh
pip install mediapipe numpy pillow

# 1. the source contact sheets (MIT, synthetic faces — see ../stock/NOTICE.md)
mkdir -p sheets && cd sheets
base=https://raw.githubusercontent.com/SelfishGene/SFHQ-T2I-dataset/main/figures
for n in Age Hair_Color Expression_x_Sex Lighting Accessories; do
  curl -L -o "g_$n.jpg" "$base/textual_search_2_${n}_top_10_matches.jpg"
done
cd ..

# 2. the landmark model
curl -L -o face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

# 3. slice -> detect + align -> hand-picked library
python3 slice_montages.py sheets cells
python3 build_stock_faces.py cells raw --size 512
python3 curate_stock.py raw ../stock
```

Between steps 2 and 3 it is worth building a contact sheet of `raw/` and looking
at it; the `KEEP` list in `curate_stock.py` is a hand-curated set of labels and
is the only place the selection lives.

## Keeping the geometry in step

`build_stock_faces.py` is a direct port of the geometry in `src/face/regions.js`
and `src/face/extract.js` — the landmark index groups, the slot padding and
aspect table, `FACE_BOX_SCALE`, `FACE_BOX_DROP`, and the `relativeRegions`
transform. **If you change any of those in the JavaScript, change them here and
rebuild**, or the shipped `rel` rectangles will no longer line up with the ones
computed at runtime for an uploaded photo, and borrowed features will land in
the wrong place.

The quickest check is to draw the manifest rectangles back onto the crops and
look at them: brows on brows, nose on nose.
