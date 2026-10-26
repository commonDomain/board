# Section backdrop textures

Seamless texture tiles for the 画框 backdrops (`frontend/styles/section-backdrops.css`), generated procedurally by `npm run build:section-backdrops` (`scripts/build-section-backdrops.js`) from seeded, periodic Perlin noise. They contain no third-party material.

Each tile is a single ink colour with a noise alpha channel, laid over the backdrop's CSS colour and drawn at half its pixel size.

| File | Used by | Size (CSS px) |
| --- | --- | --- |
| `grain.webp` | 晨雾, 毛玻璃 | 128 |
| `xuan.webp` | 宣纸 | 256 |
| `linen.webp` | 亚麻 | 192 |
| `marble.webp` | 大理石 | 512 |
