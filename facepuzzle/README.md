# 🥗 Face Salad

Drop in a photo of someone you love. Face Salad finds the face, lifts out the
eyebrows, the eyes, the nose, the mouth and the jaw as puzzle pieces, and hands
them back mixed in with **real features borrowed from two dozen other faces**.
Their real nose is in there somewhere. Probably.

It is a party game for families, couples and friends — the fun is in seeing
someone you know inside out wearing a stranger's chin, and in discovering that
you cannot actually pick your partner's eyebrows out of a lineup of six.

**Everything happens in the browser.** There is no server, no upload, no
account. The picture is decoded, measured and chopped up inside the tab and is
gone when you close it.

---

## Playing it

Open `index.html` through any web server:

```sh
node scripts/serve.mjs        # http://localhost:8080/
# or: python3 -m http.server 8080
```

(ES modules will not load from `file://`, hence the server. There is no build
step and no dependencies.)

Then either drop in a photo, paste one with ⌘V, or click one of the three
sample faces to try it without handing over anything real.

### The four modes

| Mode | What it is |
| --- | --- |
| **🧩 Studio** | The mixing table. Pick a feature, flip through the options, watch the face change. A "truth meter" tracks how much of the real person is left. |
| **🕵️ Impostor Hunt** | The actual game. Each round shows six versions of the same face that differ by *exactly one feature* — only one is genuine. Fast answers and streaks score more. |
| **💥 Scatter** | A literal jigsaw. The features are punched out of the face and dumped in a tray with four pieces that belong to nobody. Drag them back. |
| **🖼️ Fridge** | Whatever you saved, stored locally in IndexedDB. |

Keyboard: `1`–`4` switch modes, `0` goes back to the front page.

### Where the impostors come from

Most options in a lineup are **genuine features belonging to other faces**, taken
from a library of 23 portraits that ships with the app. That is the difference
between a game and a shrug: a stretched copy of somebody's own nose reads as
their nose with a filter on, whereas a real stranger's nose is a real stranger's
nose.

Nobody in that library is a real person — every image was produced by a
text-to-image model, so no actual person's face was scraped or reused. See
[`stock/NOTICE.md`](stock/NOTICE.md) for provenance and licensing.

Difficulty controls *which* strangers turn up:

| | |
| --- | --- |
| **Gentle** | strangers whose colouring is least like the hero's |
| **Tricky** | similar colouring, plus one reshaped copy of their own feature per slot |
| **Brutal** | the closest tone matches in the library, two reshaped copies, and their mirrored other side |

**It gets better again with two people.** Add a partner or a sibling and their
real features outrank the library entirely. A group photo is the fastest way in:
every face the detector finds becomes its own entry in the parts bin.

---

## How it works

```
photo ──▶ detector ──▶ regions ──▶ extract ──▶ decoys ──▶ composite
            │            │           │           ▲
       MediaPipe or   feature     upright        │        the face,
       four clicked   rectangles  square         │        reassembled
       anchors                    crop           │
                                                 │
                     stock/ ──────────────────────
                     23 pre-aligned faces, rectangles
                     precomputed offline — no detector needed
```

**Finding the face.** `src/face/detector.js` lazily pulls MediaPipe's Face
Landmarker from a CDN and asks it for 478 mesh points. That model is treated as
strictly optional: if the CDN is blocked, slow or offline, or if it simply finds
nothing, the app falls back to `src/ui/manualPicker.js`, which asks you to click
four points — both pupils, the nose tip, the middle of the mouth. Average face
proportions do the rest. The manual path also means the app works on drawings,
statues and dogs.

**The base frame.** Everything downstream works on a square crop with the eyes
levelled and the head centred (`src/face/extract.js`). Sizing and framing are
expressed in eye-distances, so pieces cut from a tilted phone snap drop cleanly
onto a face from a straight-on portrait.

**The eight slots** (`src/face/slots.js`) are hair line, jaw, both brows, both
eyes, nose and mouth. Each one carries its own padding and feathering, because a
brow needs a lot of vertical slack to come out looking like part of a face
rather than a floating strip.

**The stock library** (`src/face/stockFaces.js`, `stock/`) is what makes a single
uploaded photo playable. Each face ships pre-aligned — square, eyes level — with
its feature rectangles precomputed by the scripts in `tools/`, so loading one
costs a single image fetch and no detection at all. Only the eight strangers
chosen for the current deal are downloaded, ranked by how close their skin tone
is to the hero's.

**Making impostors** (`src/face/decoys.js`) is where the game actually lives.
Decoys come in kinds, in rough order of how convincing they are:

- `guest` — the same feature from another person you uploaded. Unbeatable.
- `stranger` — the same feature from the bundled library. The workhorse.
- `mirror` — their *other* eyebrow, flipped. Quietly uncanny.
- `twin` — their own feature, stretched, swollen, sheared, tilted and recoloured.
  Filler, and the safety net if the library cannot be reached.
- `wander` — a different feature entirely, squashed into the slot. Chaos mode.
- `doodle` — a hand-drawn cartoon part generated on the fly. Also chaos mode.

**Putting it back together** (`src/face/composite.js`) draws the hero's own crop
and paints each chosen piece into that hero's own feature rectangle — so a tall
face borrowing from a round one still ends up looking like a face. Transplanted
pieces are blended toward the destination's skin tone, which is the difference
between a swap and a sticker. An untouched piece is skipped entirely so a face
nobody has meddled with is pixel-for-pixel the original.

Transplanted pieces are re-lit to match where they land: `harmonize` in
`src/lib/canvas.js` measures the *border* of the piece — the skin around the
feature, not the feature itself, which would be dragged around by lips and
nostrils — and recentres and rescales each channel onto the destination's own
skin statistics. Matching the spread as well as the mean is what stops a face
shot in flat window light from looking pasted onto one shot under a hard lamp.

One subtlety in the quiz: a genuine piece would normally be skipped by the
compositor, since the original is already in the base at full resolution. On a
quiz board that would make the real option the only one that had not been
through a crop-and-rescale, and the softness of the others would give it away —
so `renderComposite` takes a `uniform` flag that forces every option down the
same path.

Piece edges come in two styles: a soft feathered vignette, or proper jigsaw tabs
with knobs and necks (`jigsawPath` in `src/lib/canvas.js`).

---

## Layout

```
index.html              markup shell; views are empty <section>s
stock/                  the bundled face library + manifest + NOTICE.md
tools/                  offline scripts that build stock/ (not needed to run)
styles/
  base.css              design tokens, reset, buttons, toasts
  app.css               the chrome and the five views
src/
  main.js               bootstrap, routing, file intake, keyboard
  store.js              one state object, subscribe/notify
  pipeline.js           photo ─▶ face record, with the manual fallback
  lib/
    dom.js              el(), $, clear — no framework
    canvas.js           every pixel operation: masks, warps, blending
    geometry.js         rects, bounding boxes, relative coordinates
    random.js           seeded RNG, so a face always falls apart the same way
    storage.js          IndexedDB for the fridge, localStorage for prefs
  face/
    detector.js         optional MediaPipe loader
    landmarkIndices.js  the mesh vertex groups we care about
    slots.js            the eight swappable regions
    regions.js          landmarks or anchors ─▶ rectangles
    extract.js          the upright crop and the cut pieces
    decoys.js           impostor generation
    doodles.js          procedural cartoon parts
    composite.js        reassembly, punched boards, share cards
    stockFaces.js       loads the bundled library, ranked by skin tone
  ui/
    intro.js  studio.js  hunt.js  scatter.js  gallery.js
    manualPicker.js  toast.js  effects.js
```

Every view module exports `mount(root, app)` and returns
`{ update, destroy }`; `main.js` mounts exactly one at a time.

---

## Browser support

Needs ES modules, `Path2D`, canvas `filter`, and pointer events — so any
current Chrome, Safari, Firefox or Edge. IndexedDB is optional: if the browser
refuses it (private mode, storage blocked), the Fridge quietly stays empty and
Download still works. `prefers-reduced-motion` turns off the confetti and the
transitions. `prefers-color-scheme` is respected.

## A note on whose face you use

Please only feed this pictures of people who would find it funny. It is built
for showing your sister the version of her with your dad's eyebrows, not for
anything else.

The same reasoning is why the bundled library is synthetic. Scraping portraits
of real people off the web would have been the quick way to get photorealistic
spare parts, and it would have meant shipping identifiable strangers' faces,
without their knowledge, into an app whose entire purpose is chopping faces up.
Generated faces give the same realism and depict nobody.
