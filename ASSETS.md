# 素材记录

原始角色文件保留不变；网页版本只进行等比例缩小与WebP压缩，保留透明通道。人物裁切通过CSS完成，不改动人物美术。

| 用途 | 来源 | 网页素材 |
| --- | --- | --- |
| 贝丝 | `30201_贝丝.png` | `public/assets/characters/beth.webp` |
| 兰斯 | `30100_兰斯.png` | `public/assets/characters/lance.webp` |
| 克丽丝 | `30100_克丽丝.png` | `public/assets/characters/chris.webp` |
| 伊恩 | `30201_伊恩.png` | `public/assets/characters/ian.webp` |
| 红色普通棋子 | `desert_gem_n_icon_10201.png` | `public/assets/gems/red.png` |
| 蓝色普通棋子 | `desert_gem_n_icon_10303.png` | `public/assets/gems/blue.png` |
| 绿色普通棋子 | `desert_gem_n_icon_10902.png` | `public/assets/gems/green.png` |
| 紫色普通棋子 | `desert_gem_n_icon_10504.png` | `public/assets/gems/purple.png` |
| 黄色八角星普通棋子 | 以原黄色宝石为参考，用内置图像工具改为八角星；原图 `assets-source/yellow-eight-point-star.png` | `public/assets/gems/yellow.png` |
| 问号终极棋子 | `desert_n_icon_016.png` | `public/assets/gems/ultimate.png` |

红、蓝、绿、紫及问号棋子来源目录：`E:/KOW/KOW/Assets/Data/ui/atlas/desert_n_icon/`，这五张文件是原图副本。黄色棋子按用户要求改为八角星，以区别红色三角宝石，网页版本为保留透明通道的100×100 PNG。

## 黄色八角星

使用内置 `image_gen` 工具，以原黄色三角宝石为编辑对象、红色宝石为材质参考，重新生成黄色八角星。生成原图保存于 `D:/KC三消/assets-source/yellow-eight-point-star.png`，游戏使用 `D:/KC三消/public/assets/gems/yellow.png`。八个星尖清晰可辨，原有颜色索引与消除规则不变。

完整生成提示词：

> Edit target: first attached image is the current yellow triangular gemstone game tile. Supporting style reference: second attached image is the red triangular gemstone from the same game set. Change the yellow gemstone's OUTLINE into a symmetric EIGHT-POINTED STAR gemstone (octagram). Exactly 8 clearly visible, equally spaced outward points: top, upper-right, right, lower-right, bottom, lower-left, left, upper-left. All eight points should be similar in length, with clearly indented V-shaped valleys between them, so the silhouette reads as an eight-point star at tiny game-tile sizes. The main silhouette has sixteen alternating outer and inner vertices, not an octagon and not a four-point sparkle. Keep the original fantasy-game gemstone rendering style: solid, chunky cut crystal with a large clear central table facet, angular triangular cut facets around it, a subtle thick beveled edge, crisp bright upper-left highlights and darker lower-right facets. Use warm golden YELLOW/citrine color, luminous yellow center with pale lemon highlights and amber-gold bevels. Avoid green tint. The star is one single solid jewel seen straight-on, no emblem, no additional stars, no metal setting, no particles, no rays or glow outside the silhouette, no drop shadow, no text. Centered on a square canvas, with the full jewel fitting in about 84% of the canvas width and height, maintaining comfortable transparent padding on every side. Preserve a truly transparent background (alpha), no white or black backdrop, no checkerboard baked into the pixels. This replaces an ordinary match-three tile, so visual readability and an unmistakably eight-pointed silhouette are paramount.

## 宫廷背景

使用内置 `image_gen` 工具生成，没有使用API/CLI。生成原图保存于 `D:/KC三消/assets-source/palace.png`，网页优化版为 `D:/KC三消/public/assets/environment/palace.webp`。

完整生成提示词：

> Use case: historical-scene. Asset type: wide background artwork for a playable medieval royal court match-three browser game. Create a refined understated European medieval palace gallery interior, wide landscape composition 16:9. Warm limestone archways and slender stone columns, quiet worn stone tile floor, distant tall windows admitting soft late-afternoon light, a little muted forest-green fabric and subdued antique brass. Architectural depth at left and edges, relatively calm darkened stone wall and shadow across the right half where a game board will overlay; the left third will have a standing character overlaid. Beautiful softly painted realistic game environment, atmospheric but readable, pale warm natural light contrasting gently with olive-brown shadows. Restrained noble atmosphere, no ornate throne, no elaborate gold decoration, no grand staircase, no purple neon, no magical sparkles, no characters, no text, no UI, no border. The background must support the game UI without competing with it.

重新压缩本地图片：`node scripts/prepare-assets.mjs`。

中文字体按本原型使用的字形做本地子集；更换界面文字后可执行 `node scripts/prepare-fonts.mjs` 重新获取子集（此素材准备步骤需要网络，游戏运行不需要）。字体缺字时使用系统宋体后备。
