import argparse
import html
import pathlib
import subprocess
import sys
from urllib.parse import quote


def md_to_html(md_text: str) -> str:
    try:
        import markdown  # type: ignore

        body = markdown.markdown(md_text, extensions=["tables", "fenced_code"])
    except Exception:
        # Fallback: plain preformatted text
        body = f"<pre>{html.escape(md_text)}</pre>"

    return f"""<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {{
      font-family: "Microsoft JhengHei", "PingFang TC", "Noto Sans CJK TC", sans-serif;
      line-height: 1.6;
      margin: 24px;
      color: #222;
      font-size: 14px;
    }}
    h1, h2, h3 {{ margin: 14px 0 8px; }}
    table {{ border-collapse: collapse; width: 100%; margin: 10px 0; }}
    th, td {{ border: 1px solid #ddd; padding: 6px 8px; text-align: left; }}
    code {{ background: #f4f4f4; padding: 1px 4px; border-radius: 4px; }}
    pre {{ background: #f7f7f7; padding: 10px; border-radius: 6px; overflow: auto; }}
    ul, ol {{ padding-left: 22px; }}
  </style>
</head>
<body>
{body}
</body>
</html>"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    input_path = pathlib.Path(args.input).resolve()
    output_path = pathlib.Path(args.output).resolve()
    temp_html = output_path.with_suffix(".tmp.export.html")

    md_text = input_path.read_text(encoding="utf-8")
    temp_html.write_text(md_to_html(md_text), encoding="utf-8")

    edge_path = pathlib.Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
    if not edge_path.exists():
        print("Edge executable not found.", file=sys.stderr)
        return 1

    file_url = "file:///" + quote(str(temp_html).replace("\\", "/"), safe="/:.")
    cmd = [
        str(edge_path),
        "--headless",
        "--disable-gpu",
        f"--print-to-pdf={str(output_path)}",
        "--no-pdf-header-footer",
        file_url,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(proc.stdout)
        print(proc.stderr, file=sys.stderr)
        return proc.returncode

    temp_html.unlink(missing_ok=True)
    print(f"PDF exported: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
