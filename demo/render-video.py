from pathlib import Path
import os

from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "assets" / "scopelock-demo.mp4"
ICON = ROOT / "assets" / "icon.png"
WIDTH, HEIGHT = 1280, 720
FPS = 24
DURATION = 14

NAVY = "#0B1020"
PANEL = "#111A2D"
CYAN = "#65D4FF"
AMBER = "#FFB454"
WHITE = "#F5F7FA"
MUTED = "#9AA7BD"
RED = "#FF6B6B"


def font(size, bold=False, mono=False):
    candidates = []
    if os.name == "nt":
        if mono:
            candidates.extend([Path("C:/Windows/Fonts/CascadiaMono.ttf"), Path("C:/Windows/Fonts/consola.ttf")])
        elif bold:
            candidates.extend([Path("C:/Windows/Fonts/seguisb.ttf"), Path("C:/Windows/Fonts/arialbd.ttf")])
        else:
            candidates.extend([Path("C:/Windows/Fonts/segoeui.ttf"), Path("C:/Windows/Fonts/arial.ttf")])
    else:
        candidates.extend([Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")])
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


TITLE = font(64, bold=True)
SUBTITLE = font(34)
BODY = font(28)
SMALL = font(22)
MONO = font(24, mono=True)
MONO_BOLD = font(25, bold=True, mono=True)


def centered(draw, text, y, text_font, fill):
    box = draw.textbbox((0, 0), text, font=text_font)
    x = (WIDTH - (box[2] - box[0])) // 2
    draw.text((x, y), text, font=text_font, fill=fill)


def terminal(draw, title, lines):
    left, top, right, bottom = 90, 130, WIDTH - 90, HEIGHT - 95
    draw.rounded_rectangle((left, top, right, bottom), radius=22, fill=PANEL, outline="#22314D", width=2)
    draw.rounded_rectangle((left, top, right, top + 58), radius=22, fill="#162239")
    draw.rectangle((left, top + 35, right, top + 58), fill="#162239")
    for index, color in enumerate((RED, AMBER, CYAN)):
        draw.ellipse((left + 24 + index * 31, top + 21, left + 38 + index * 31, top + 35), fill=color)
    draw.text((left + 130, top + 17), title, font=SMALL, fill=MUTED)
    y = top + 92
    for text, color, emphasized in lines:
        draw.text((left + 38, y), text, font=MONO_BOLD if emphasized else MONO, fill=color)
        y += 43


def frame_at(second):
    image = Image.new("RGB", (WIDTH, HEIGHT), NAVY)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, WIDTH, 8), fill=CYAN)

    if second < 2.4:
        icon = Image.open(ICON).convert("RGB").resize((190, 190), Image.Resampling.LANCZOS)
        image.paste(icon, ((WIDTH - 190) // 2, 105))
        centered(draw, "ScopeLock", 330, TITLE, WHITE)
        centered(draw, "Keep AI coding work inside the task you approved.", 425, SUBTITLE, MUTED)
        centered(draw, "Local-first. Evidence-labeled. Advisory.", 505, BODY, CYAN)
    elif second < 5.2:
        terminal(draw, "1. Lock the task", [
            ("> Lock this task to src/auth/ and tests/auth/.", WHITE, True),
            ("objective: Harden the login redirect", MUTED, False),
            ("allowed: src/auth/  tests/auth/", CYAN, False),
            ("baseline: captured", CYAN, False),
            ("warning: detects and warns; not a sandbox", AMBER, False),
        ])
    elif second < 8.2:
        terminal(draw, "2. Compare current changes", [
            ("> Are we still inside the approved scope?", WHITE, True),
            ("IN SCOPE     src/auth/login.js", CYAN, False),
            ("OUT OF SCOPE config/prod.json", AMBER, True),
            ("health: drift", AMBER, False),
            ("authorship: not claimed", MUTED, False),
        ])
    elif second < 11.2:
        terminal(draw, "3. Verify with exact evidence", [
            ("> Verify and run node --test", WHITE, True),
            ("validation: passed (exit 0)", CYAN, False),
            ("scope finding: config/prod.json", AMBER, False),
            ("outcome: FAIL", RED, True),
            ("report: immutable and local", MUTED, False),
        ])
    else:
        centered(draw, "Detected, not blocked.", 210, TITLE, WHITE)
        centered(draw, "Review the drift. Fix it. Verify again.", 320, SUBTITLE, CYAN)
        centered(draw, "No account  |  No telemetry  |  No hidden cleanup", 420, BODY, MUTED)
        centered(draw, "ScopeLock 0.1.0", 520, SMALL, AMBER)

    progress = int(WIDTH * min(1.0, second / DURATION))
    draw.rectangle((0, HEIGHT - 7, progress, HEIGHT), fill=AMBER)
    return image


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    writer = imageio_ffmpeg.write_frames(
        str(OUTPUT),
        (WIDTH, HEIGHT),
        fps=FPS,
        codec="libx264",
        quality=7,
        output_params=["-pix_fmt", "yuv420p", "-movflags", "+faststart"],
    )
    writer.send(None)
    try:
        for index in range(FPS * DURATION):
            writer.send(frame_at(index / FPS).tobytes())
    finally:
        writer.close()
    print(OUTPUT)


if __name__ == "__main__":
    main()
