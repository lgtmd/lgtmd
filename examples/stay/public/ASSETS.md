# Stay image provenance

These three photorealistic images were generated for Stay's fictional properties
on 2026-10-14 using Codex's built-in image-generation tool. They replace the
original SVG illustrations at the user's request. They are generated imagery,
not camera photographs, and do not identify real properties available to book.
No external source photographs, stock-photo library, hotel branding or reference
images were used.

| Asset                                        | Scene                                                 | Retained size              |
| -------------------------------------------- | ----------------------------------------------------- | -------------------------- |
| [Cedar House](images/cedar-house.webp)       | A cedar retreat and walking trail among autumn trees  | 1536 × 1024; 631,362 bytes |
| [Courtyard Loft](images/courtyard-loft.webp) | A leafy private courtyard outside a sunlit brick loft | 1536 × 1024; 486,422 bytes |
| [Coast Cabin](images/coast-cabin.webp)       | A weathered timber cabin above the Pacific            | 1536 × 1024; 394,520 bytes |

PNG generation outputs were encoded as WebP using pinned Sharp 0.35.5 / libwebp
1.6.0, quality 88, effort 6, at their original dimensions. This is a photographic
asset encoding choice; documentation screenshots still use the existing lossless
WebP capture helper. The original PNGs remain in ignored local review storage.

Retained SHA-256 checksums:

```text
cedar-house.webp     292f08a2a5e184ed9d2e08d2c02c45ce12045164f6920e339d041dbce05b62b3
courtyard-loft.webp  8495bff11c5121f6919e850ae492b76a0f2f57e89e75cfeac051875cdd1e99cf
coast-cabin.webp     24ef5f796b03e5ee5b2dcf35f9968e475779fa56609245bf1bce0d177252a7ab
```

The app uses local retained images and system fonts. Normal development,
documentation collection and verification do not call an image generator, image
service, font CDN or model provider. Generation was a separate asset-authoring
step; reruns reuse these exact retained bytes. Image generation is not part of
the mocked reply workflow.

## Generation prompts

Each prompt below produced one independent image with the built-in tool, without
input images or the CLI/API fallback.

### cedar-house

```text
Use case: photorealistic-natural. Asset type: accommodation listing photograph for the fictional Stay demo. Generate one finished landscape 3:2 photo, no collage. A believable compact two-bedroom cedar-clad retreat in the Hudson Valley, New York, among mature autumn trees, a modest sunny deck and a narrow walking trail beyond the garden. Pitched roof, warm timber siding with subtle weathering, generous windows reflecting trees, understated comfortable architecture. Natural late-afternoon daylight, soft shadows, quiet lived-in warmth, realistic wood grain, leaves and glass. Professional editorial architectural photography, eye-level three-quarter view, 35mm lens, crisp but natural detail, balanced exposure, restrained earthy colors, absolutely photographic rather than an illustration or architectural CGI render. House clearly visible and centered with surrounding trees; compose to survive a center crop to a listing card. No people, signage, words, logos, watermark, cars or exaggerated luxury. Fictional property; no real hotel branding.
```

### courtyard-loft

```text
Use case: photorealistic-natural. Asset type: accommodation listing photograph for the fictional Stay demo. Generate one finished landscape 3:2 photo, no collage. A quiet leafy courtyard outside a beautiful renovated red-brick loft in a walkable Portland, Oregon neighborhood. Large black-framed industrial windows reveal a warm sunlit one-bedroom loft with pale linen seating and natural oak furniture. In the foreground a small private paved patio, two simple chairs, pots of ferns and climbing plants; believable unpretentious architecture with detailed brickwork and old timber. Professional editorial accommodation photography, natural soft daylight with gentle afternoon warmth, realistic material texture, balanced exposure, 35mm lens at eye level, restrained earthy palette, crisp photographic detail with real-world imperfections. The courtyard and loft facade remain clear in a center crop for listing cards. Absolutely photorealistic, not flat illustration, 3D visualization, overly glossy luxury advertising or HDR. No people, text, logos, signage or watermarks. Fictional property, no identifiable hotel brand.
```

### coast-cabin

```text
Use case: photorealistic-natural. Asset type: accommodation listing photograph for the fictional Stay demo. Generate one finished landscape 3:2 photo, no collage. A small thoughtfully furnished coastal timber cabin on a grassy bluff above the Pacific near Mendocino, California. Natural weathered cedar siding, modest pitched roof, broad ocean-facing windows and a simple private deck with two wooden chairs; ocean, rocky coast and native coastal plants visible behind and beside the cabin. Calm lightly misty afternoon with soft natural light, muted sea blues, warm wood and sage coastal vegetation. Professional editorial architectural photography, eye-level three-quarter view, 35mm lens, realistic wood, glass, grass and sea texture, balanced exposure, attractive but believable lived-in retreat. Cabin is the clear central subject and fits a center crop for a listing card; enough ocean visible to convey the setting. Strictly photographic, not illustration, not CGI render, not fantasy architecture or exaggerated luxury. No people, words, logos, watermark or real hotel branding. Fictional accommodation.
```
