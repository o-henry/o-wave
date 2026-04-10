#!/usr/bin/env python3
"""Render a small Rich TUI probe for line-style and color checks."""

from __future__ import annotations

import argparse
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render a Rich box/line/color probe for terminal rendering checks."
    )
    parser.add_argument(
        "--box",
        dest="box_name",
        default="square",
        choices=["square", "heavy", "double", "rounded", "minimal"],
        help="Rich box style to use.",
    )
    parser.add_argument(
        "--theme",
        default="slate",
        choices=["slate", "amber", "matrix", "mono"],
        help="Color preset to use.",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=96,
        help="Target console width.",
    )
    return parser.parse_args()


def main() -> int:
    try:
        from rich import box
        from rich.console import Console
        from rich.panel import Panel
        from rich.table import Table
        from rich.text import Text
    except ImportError:
        print(
            "rich is not installed in this Python environment.\n"
            "Try one of:\n"
            "  pip install rich\n"
            "  python -m pip install rich\n"
            "  <your venv>/bin/python scripts/rich_terminal_probe.py",
            file=sys.stderr,
        )
        return 1

    args = parse_args()

    box_map = {
        "square": box.SQUARE,
        "heavy": box.HEAVY,
        "double": box.DOUBLE,
        "rounded": box.ROUNDED,
        "minimal": box.MINIMAL_HEAVY_HEAD,
    }
    theme_map = {
        "slate": {
            "border": "#cbd5e1",
            "title": "#f8fafc",
            "accent": "#93c5fd",
            "muted": "#cbd5e1",
            "value": "#e2e8f0",
            "bg": "#1e293b",
        },
        "amber": {
            "border": "#fbbf24",
            "title": "#fef3c7",
            "accent": "#f59e0b",
            "muted": "#fde68a",
            "value": "#fff7ed",
            "bg": "#292524",
        },
        "matrix": {
            "border": "#4ade80",
            "title": "#dcfce7",
            "accent": "#22c55e",
            "muted": "#86efac",
            "value": "#f0fdf4",
            "bg": "#052e16",
        },
        "mono": {
            "border": "white",
            "title": "white",
            "accent": "bright_white",
            "muted": "grey85",
            "value": "white",
            "bg": "black",
        },
    }
    palette = theme_map[args.theme]

    console = Console(width=args.width)

    header = Text("RICH TERMINAL PROBE", style=f"bold {palette['title']}")
    header.append("  ", style=palette["title"])
    header.append(f"box={args.box_name}", style=f"bold {palette['accent']}")
    header.append("  ", style=palette["title"])
    header.append(f"theme={args.theme}", style=f"bold {palette['accent']}")

    info = Table(
        box=box_map[args.box_name],
        expand=True,
        border_style=palette["border"],
        header_style=f"bold {palette['title']}",
        style=palette["value"],
        show_lines=False,
        pad_edge=False,
    )
    info.add_column("KEY", style=f"bold {palette['muted']}", no_wrap=True, width=24)
    info.add_column("VALUE", style=palette["value"])
    info.add_row("VERTICAL SAMPLE", "│ │ │ │ │ │ │ │ │ │")
    info.add_row("HEAVY SAMPLE", "┃ ┃ ┃ ┃ ┃ ┃ ┃ ┃ ┃ ┃")
    info.add_row("MIXED BOX", "╭────────────────────────────╮")
    info.add_row("MIXED BOX", "│ straight vertical line test │")
    info.add_row("MIXED BOX", "╰────────────────────────────╯")
    info.add_row("ASCII CONTROL", "| | | | | | | | | |")
    info.add_row("BLOCK SHADE", "█ ▓ ▒ ░ █ ▓ ▒ ░")
    info.add_row("KOREAN TEXT", "첫 10분 몰입감과 정렬 상태 확인")
    info.add_row("NERD GLYPHS", "󰆍 󰈔 󰌑 󰋜 󰘳")

    ruler = Table(
        box=box_map[args.box_name],
        expand=True,
        border_style=palette["border"],
        header_style=f"bold {palette['title']}",
        style=palette["value"],
        pad_edge=False,
    )
    for idx in range(1, 6):
        ruler.add_column(f"C{idx}", justify="center")
    ruler.add_row("│", "│", "│", "│", "│")
    ruler.add_row("┃", "┃", "┃", "┃", "┃")
    ruler.add_row("|", "|", "|", "|", "|")
    ruler.add_row("I", "I", "I", "I", "I")

    console.print()
    console.print(
        Panel(
            header,
            box=box_map[args.box_name],
            border_style=palette["border"],
            style=f"on {palette['bg']}",
            padding=(1, 2),
            expand=True,
        )
    )
    console.print()
    console.print(info)
    console.print()
    console.print(ruler)
    console.print()

    footer = Text("If Rich vertical lines still look dotted, compare against the ASCII CONTROL row above.")
    footer.stylize(f"bold {palette['muted']}")
    console.print(footer)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
