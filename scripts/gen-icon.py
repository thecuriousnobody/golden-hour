#!/usr/bin/env python3
"""
Generate Golden Hour app icon set for Android.

Concept: warm amber radial gradient (the golden hour of trauma care)
with a bold white medical cross centered. Simple, recognizable from
across a homescreen.
"""

from PIL import Image, ImageDraw, ImageFilter
import os, sys

ANDROID_RES = "/Users/rajeevkumar/Documents/GIT_Repos/golden-hour/android/app/src/main/res"

# Density buckets for the legacy (square + round) launcher icons
LEGACY_SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

# Adaptive-icon foreground (108dp canvas, content in inner 72dp safe zone)
FOREGROUND_SIZES = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}

# Sunset/golden hour gradient endpoints
INNER = (252, 211, 77)   # amber-300 — bright golden
OUTER = (194, 65, 12)    # orange-700 — deep ember
# Foreground: solid white cross
WHITE = (255, 255, 255, 255)


def draw_gradient_disk(size: int) -> Image.Image:
    """Square image with a radial amber gradient that fills the whole canvas."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx = cy = size / 2.0
    max_r = size / 2.0
    # Step radially from edge inward so the inner ring paints over the outer.
    steps = max(64, size)
    for i in range(steps, 0, -1):
        t = i / steps
        r = max_r * t
        # ease t so the bright center isn't too small
        ease = t * t
        color = tuple(
            int(INNER[c] + (OUTER[c] - INNER[c]) * ease) for c in range(3)
        ) + (255,)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
    return img


def draw_square_gradient(size: int) -> Image.Image:
    """Square gradient that fills the whole canvas (for the legacy square icon)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    cx = cy = size / 2.0
    max_d = (cx ** 2 + cy ** 2) ** 0.5
    for y in range(size):
        for x in range(size):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            t = min(1.0, d / max_d)
            ease = t * t
            r = int(INNER[0] + (OUTER[0] - INNER[0]) * ease)
            g = int(INNER[1] + (OUTER[1] - INNER[1]) * ease)
            b = int(INNER[2] + (OUTER[2] - INNER[2]) * ease)
            px[x, y] = (r, g, b, 255)
    return img


def add_cross(img: Image.Image, thickness_frac=0.18, length_frac=0.50,
              color=WHITE, shadow=True) -> Image.Image:
    """Stamp a centered white medical cross onto the image."""
    size = img.size[0]
    cx = cy = size / 2.0
    t = size * thickness_frac
    L = size * length_frac
    # Optional soft drop shadow for depth on dark/saturated bg
    if shadow:
        shadow_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow_layer)
        offset = size * 0.012
        sd.rectangle(
            [cx - L / 2 + offset, cy - t / 2 + offset,
             cx + L / 2 + offset, cy + t / 2 + offset],
            fill=(0, 0, 0, 90),
        )
        sd.rectangle(
            [cx - t / 2 + offset, cy - L / 2 + offset,
             cx + t / 2 + offset, cy + L / 2 + offset],
            fill=(0, 0, 0, 90),
        )
        shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(size * 0.012))
        img = Image.alpha_composite(img, shadow_layer)

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rectangle(
        [cx - L / 2, cy - t / 2, cx + L / 2, cy + t / 2], fill=color
    )
    od.rectangle(
        [cx - t / 2, cy - L / 2, cx + t / 2, cy + L / 2], fill=color
    )
    return Image.alpha_composite(img, overlay)


def round_mask(img: Image.Image) -> Image.Image:
    """Crop to a circle (for ic_launcher_round)."""
    size = img.size[0]
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size, size], fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def main():
    # Master 1024 source for review + future tweaks
    src_size = 1024
    print("Rendering source icon @ 1024 …")
    src_sq = draw_square_gradient(src_size)
    src_sq = add_cross(src_sq)
    src_path = "/tmp/golden-hour-icon-source.png"
    src_sq.save(src_path)
    print(f"  → {src_path}")

    # Legacy square + round launcher icons
    for folder, size in LEGACY_SIZES.items():
        out_dir = os.path.join(ANDROID_RES, folder)
        os.makedirs(out_dir, exist_ok=True)
        sq = src_sq.resize((size, size), Image.LANCZOS)
        sq.save(os.path.join(out_dir, "ic_launcher.png"))
        round_mask(sq).save(os.path.join(out_dir, "ic_launcher_round.png"))
        print(f"  → {folder}/ic_launcher{{,_round}}.png  ({size}×{size})")

    # Adaptive-icon foreground: cross-only, transparent background, in
    # the inner 72/108 safe zone of a 108dp canvas.
    print("Rendering adaptive foreground …")
    for folder, fsize in FOREGROUND_SIZES.items():
        out_dir = os.path.join(ANDROID_RES, folder)
        os.makedirs(out_dir, exist_ok=True)
        fg = Image.new("RGBA", (fsize, fsize), (0, 0, 0, 0))
        # Render the cross at a size that fits in the inner 72/108 ≈ 0.667 safe zone
        safe = int(fsize * 0.667)
        cross_img = Image.new("RGBA", (safe, safe), (0, 0, 0, 0))
        cross_img = add_cross(cross_img, thickness_frac=0.22, length_frac=0.80, shadow=False)
        offset = (fsize - safe) // 2
        fg.paste(cross_img, (offset, offset), cross_img)
        fg.save(os.path.join(out_dir, "ic_launcher_foreground.png"))
        print(f"  → {folder}/ic_launcher_foreground.png  ({fsize}×{fsize})")

    print("Done.")


if __name__ == "__main__":
    main()
