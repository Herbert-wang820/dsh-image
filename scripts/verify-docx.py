#!/usr/bin/env python3
"""Verify a generated .docx without an Office application.

Word itself is unavailable in this environment and LibreOffice cannot start under
the sandbox, so this checks the package the way an Office consumer would before
rendering: CRC integrity, XML well-formedness, relationship and content-type
coverage, embedded-media bytes, and the drawing extent's aspect ratio. It proves
the file is a structurally valid OOXML document; it does not prove visual layout.
"""
from __future__ import annotations

import argparse
import hashlib
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
CT = "{http://schemas.openxmlformats.org/package/2006/content-types}"
REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
PIC = "{http://schemas.openxmlformats.org/drawingml/2006/picture}"

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        failures.append(message)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("docx")
    parser.add_argument("--expect-image", help="source image whose bytes must be embedded verbatim")
    parser.add_argument("--expect-text", action="append", default=[])
    args = parser.parse_args()

    path = Path(args.docx).resolve()
    print(f"verifying {path}")
    check(path.is_file() and path.stat().st_size > 0, f"file exists and is non-empty ({path.stat().st_size if path.exists() else 0} bytes)")

    with zipfile.ZipFile(path) as package:
        check(package.testzip() is None, "zip CRCs pass")
        parts = package.namelist()

        for required in ("[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels"):
            check(required in parts, f"required part present: {required}")

        for part in parts:
            if not part.endswith((".xml", ".rels")):
                continue
            try:
                ElementTree.fromstring(package.read(part))
                ok, note = True, "well-formed XML"
            except ElementTree.ParseError as error:
                ok, note = False, f"XML parse error: {error}"
            check(ok, f"{part}: {note}")

        types = ElementTree.fromstring(package.read("[Content_Types].xml"))
        defaults = {entry.get("Extension", "").lower() for entry in types.findall(f"{CT}Default")}
        overrides = {entry.get("PartName") for entry in types.findall(f"{CT}Override")}
        for part in parts:
            if part == "[Content_Types].xml":
                continue
            extension = part.rsplit(".", 1)[-1].lower()
            check(f"/{part}" in overrides or extension in defaults, f"content type covers {part}")

        document = ElementTree.fromstring(package.read("word/document.xml"))
        relationships = ElementTree.fromstring(package.read("word/_rels/document.xml.rels"))
        targets = {}
        for entry in relationships.findall(f"{REL}Relationship"):
            target = entry.get("Target") or ""
            resolved = "word/" + target if not target.startswith("/") else target[1:]
            targets[entry.get("Id")] = resolved
            check(resolved in parts, f"relationship {entry.get('Id')} -> {resolved} exists in package")

        blips = [node.get(f"{{http://schemas.openxmlformats.org/officeDocument/2006/relationships}}embed") for node in document.iter(f"{A}blip")]
        check(len(blips) == 1 and blips[0] is not None, f"document references exactly one inline image ({len(blips)} blip(s))")
        if blips and blips[0]:
            media_part = targets.get(blips[0])
            check(media_part is not None, f"image relationship {blips[0]} resolves")
            if media_part:
                media = package.read(media_part)
                check(len(media) > 0, f"embedded media is non-empty ({len(media)} bytes)")

                extents = [node for node in document.iter(f"{WP}extent")]
                check(len(extents) >= 1, "drawing carries an extent")
                if extents:
                    cx, cy = int(extents[0].get("cx", "0")), int(extents[0].get("cy", "0"))
                    check(cx > 0 and cy > 0, f"extent is positive ({cx}x{cy} EMU)")
                    try:
                        from PIL import Image
                        with Image.open(args.expect_image or media_part) as probe:  # type: ignore[arg-type]
                            pixels = probe.size
                    except Exception:
                        pixels = None
                    if pixels:
                        want = cx / cy
                        got = pixels[0] / pixels[1]
                        check(abs(want - got) < 0.02, f"extent aspect {want:.4f} matches image {pixels[0]}x{pixels[1]} ({got:.4f})")

                if args.expect_image:
                    source = Path(args.expect_image).read_bytes()
                    check(hashlib.sha256(source).hexdigest() == hashlib.sha256(media).hexdigest(),
                          "embedded media bytes are identical to the generated source image")

        text = "".join(node.text or "" for node in document.iter(f"{W}t"))
        for needle in args.expect_text:
            check(needle in text, f"document text contains {needle!r}")

    print("RESULT:", "FAIL" if failures else "PASS (structural checks only; visual layout not rendered)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
