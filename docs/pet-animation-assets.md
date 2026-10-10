# Toolbar pet motion assets

The four added source PNGs were created with the built-in `image_gen` edit tool. The reference and output files are all in this repository. The transparent source images were converted into the bundled 418 × 418 WebP sprites using the bounds below. The application uses the generated files in `public/pet/` directly.

| Reference | Source PNG | WebP sprite | Target bounds |
| --- | --- | --- | --- |
| `public/pet/corgi-stand.webp` | `design-system/museboard/assets/corgi-walk-front-source.png` | `public/pet/corgi-walk-front.webp` | `61,27,410,400` |
| `design-system/museboard/assets/corgi-walk-front-source.png` | `design-system/museboard/assets/corgi-walk-front-alt-source.png` | `public/pet/corgi-walk-front-alt.webp` | `61,27,410,400` |
| `public/pet/corgi-walk-right-alt.webp` | `design-system/museboard/assets/corgi-run-right-source.png` | `public/pet/corgi-run-right.webp` | `25,62,390,330` |
| `design-system/museboard/assets/corgi-run-right-source.png` | `design-system/museboard/assets/corgi-run-right-alt-source.png` | `public/pet/corgi-run-right-alt.webp` | `25,62,390,330` |

## Final image prompts

### Front contact A

> Use case: precise-object-edit. Asset type: one animation frame for a tiny website pet sprite. Edit the supplied transparent-background corgi image into an adjacent DOWNWARD / toward-viewer walking contact pose. Keep exactly the same individual corgi identity, fur markings, face, ears, expression, realistic softly illustrated rendering, light direction, color, camera angle (three-quarter front looking slightly right), body proportions, framing, and genuinely transparent alpha background. Change only the four legs/paws and the smallest physically necessary shoulder/hip shift: left forepaw reaches a short distance forward and contacts the ground, right forepaw is lifted slightly and trails; the opposite hind leg pushes. Natural short corgi legs, believable paw joints, coordinated diagonal pair, modest walking stride, no leap. Full dog visible, no crop, no ground, no props, no text, no extra limbs, no motion blur. Preserve enough transparent padding around the dog for consistent sprite registration.

### Front contact B

> Use case: precise-object-edit. This is frame B in a two-frame corgi walk cycle for a 92px website sprite. Preserve the entire supplied image pixel-for-pixel as much as possible EXCEPT for the paws and legs below the lower chest/belly. Preserve exact head, eyes, ears, nose, mouth, torso silhouette, fur colors, light, transparent background, camera, position and dimensions. Make a visibly DIFFERENT opposite walking step: the large front paw at image x≈760,y≈1130 (currently planted far forward) moves backward and lifts 80 image pixels off the ground; the other front paw at image x≈920,y≈1040 comes forward and plants at y≈1180. Swap the rear paws' support roles subtly. Four anatomically correct legs only. This must be a complementary leg contact frame, with head and body completely stable. No background, shadow, props, text, blur, or crop.

### Rightward run contact A

> Use case: precise-object-edit. Asset type: a fast trot / short corgi run animation frame for a 92px website pet sprite. Reference image is the exact character and style to preserve: same corgi identity, silhouette, face, ear size, brown and white fur markings, lighting, painterly photoreal finish, right-facing three-quarter side camera, transparent background. Change the lower body and paws into an anatomically plausible extended fast-trot contact frame: near front paw reaches forward a little farther and plants, far front paw is lifted; diagonal opposite hind paw pushes back, other hind paw gathers under belly. Head and torso remain approximately level and same placement, no airborne jump, no elongated legs. Use short corgi limb proportions and readable distinct paw positions at thumbnail scale. Full dog visible with transparent padding; no ground, shadow, props, text, additional limbs, or blur.

### Rightward run contact B

> Use case: precise-object-edit. Asset type: complementary contact frame B of a 2-frame fast corgi trot animation. Keep the dog in the reference exactly the same above the lower chest and belly: same head and ears, expression, nose, fur, torso position/silhouette, scale, lighting, right-facing three-quarter side view and transparent canvas. Change only the four short legs/paws to the OPPOSITE diagonal support state: near foreground front paw, which now reaches forward and plants, should bend and lift back under the chest; far front paw should reach forward and plant. The rear paw currently extending back should tuck and support; the other rear paw should extend and push. Clear distinction in paw positions at 92px sprite scale, natural joints, no stretched legs, no floating jump. Full dog visible. No background, ground, shadow, props, text, additional limbs, or blur.
