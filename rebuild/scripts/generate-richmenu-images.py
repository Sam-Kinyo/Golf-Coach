from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

WIDTH, HEIGHT = 2500, 843
BTN_W = WIDTH // 4
BG_TOP = (236, 247, 239)
BG_BOTTOM = (219, 239, 226)
BTN = (255, 255, 255)
BTN_BORDER = (180, 210, 189)
TEXT = (24, 60, 42)
SUB = (63, 105, 81)
ACCENT = (14, 148, 86)
ICON_BG = (232, 250, 238)
ICON_BORDER = (166, 223, 186)
WHITE = (255, 255, 255)


def get_font(size: int):
    candidates = [
        r"C:\Windows\Fonts\msjh.ttc",
        r"C:\Windows\Fonts\msjhbd.ttc",
        r"C:\Windows\Fonts\mingliu.ttc",
    ]
    for p in candidates:
        if Path(p).exists():
            return ImageFont.truetype(p, size=size)
    return ImageFont.load_default()


def draw_golf_icon(draw: ImageDraw.ImageDraw, idx: int, cx: int, top: int):
    # Common circular icon container
    r = 56
    cy = top + 112
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=ICON_BG, outline=ICON_BORDER, width=3)

    # 4 golf-themed icons
    if idx == 0:
        # Golf ball on tee
        draw.ellipse((cx - 22, cy - 26, cx + 22, cy + 18), fill=WHITE, outline=(190, 190, 190), width=2)
        draw.polygon([(cx - 10, cy + 24), (cx + 10, cy + 24), (cx, cy + 42)], fill=ACCENT)
        draw.line((cx, cy + 18, cx, cy + 28), fill=ACCENT, width=4)
    elif idx == 1:
        # Flag on green
        draw.line((cx - 18, cy + 30, cx - 18, cy - 24), fill=ACCENT, width=5)
        draw.polygon([(cx - 18, cy - 24), (cx + 20, cy - 14), (cx - 18, cy - 4)], fill=(255, 78, 78))
        draw.arc((cx - 34, cy + 12, cx + 34, cy + 52), start=200, end=340, fill=ACCENT, width=4)
        draw.ellipse((cx + 4, cy + 22, cx + 18, cy + 36), fill=WHITE, outline=(185, 185, 185), width=2)
    elif idx == 2:
        # Club + ball
        draw.line((cx - 28, cy + 28, cx + 12, cy - 12), fill=(90, 90, 90), width=5)
        draw.rounded_rectangle((cx + 8, cy - 16, cx + 28, cy + 2), radius=4, fill=(70, 70, 70))
        draw.ellipse((cx - 12, cy + 10, cx + 6, cy + 28), fill=WHITE, outline=(185, 185, 185), width=2)
    else:
        # Hole + ball trail
        draw.arc((cx - 34, cy + 8, cx + 34, cy + 52), start=200, end=340, fill=ACCENT, width=4)
        draw.ellipse((cx - 6, cy + 28, cx + 6, cy + 40), fill=(70, 70, 70))
        draw.ellipse((cx - 34, cy - 8, cx - 18, cy + 8), fill=WHITE, outline=(185, 185, 185), width=2)
        draw.line((cx - 22, cy + 2, cx - 10, cy + 14), fill=(170, 170, 170), width=3)


def draw_menu(labels, output_path: Path):
    img = Image.new("RGB", (WIDTH, HEIGHT), BG_TOP)
    draw = ImageDraw.Draw(img)
    font = get_font(120)
    small = get_font(38)

    # Soft vertical gradient background
    for y in range(HEIGHT):
        t = y / max(HEIGHT - 1, 1)
        r = int(BG_TOP[0] * (1 - t) + BG_BOTTOM[0] * t)
        g = int(BG_TOP[1] * (1 - t) + BG_BOTTOM[1] * t)
        b = int(BG_TOP[2] * (1 - t) + BG_BOTTOM[2] * t)
        draw.line((0, y, WIDTH, y), fill=(r, g, b))

    draw.rounded_rectangle((26, 26, WIDTH - 26, HEIGHT - 26), radius=42, outline=(205, 216, 228), width=3)

    for i, label in enumerate(labels):
        x0 = i * BTN_W + 22
        x1 = (i + 1) * BTN_W - 22
        y0, y1 = 60, 780
        draw.rounded_rectangle((x0, y0, x1, y1), radius=54, fill=BTN, outline=BTN_BORDER, width=3)
        cx = (x0 + x1) // 2
        cy = (y0 + y1) // 2
        bbox = draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = cx - tw / 2
        ty = cy - th / 2
        draw.text((tx, ty), label, font=font, fill=TEXT)

    img.save(output_path, "PNG")


def main():
    root = Path(__file__).resolve().parent
    draw_menu(["教練後台", "查詢今日", "查詢明日", "使用教學"], root / "richmenu-coach.png")
    draw_menu(["學員專區", "我的預約", "我的堂數", "使用教學"], root / "richmenu-student.png")
    print("Rich menu images generated.")


if __name__ == "__main__":
    main()
