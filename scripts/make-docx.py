#!/usr/bin/env python3
"""Build a minimal, Word-compatible .docx that embeds one image.

The auto-visual plugin generates and registers image assets; it deliberately does
not write Office files. This script performs that last step so the pipeline can be
checked end to end. It writes OOXML directly (no python-docx dependency) and takes
every fact from the command line, so no credential ever reaches the document.

Never pass an API key, token or endpoint host through --meta/--note/--intro: this
document is committed as a published example. `test/repo-hygiene.test.ts` scans
the committed document and fails on a credential, a local path or an endpoint row.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image

EMU_PER_INCH = 914400
CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>
"""
ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""
DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.{ext}"/>
</Relationships>
"""
STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="SimSun"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
<w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/>
<w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="240"/></w:pPr>
<w:rPr><w:i/><w:color w:val="595959"/><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Meta"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:color w:val="404040"/><w:sz w:val="19"/></w:rPr></w:style>
</w:styles>
"""
NS = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'
)
SECT_PR = (
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/>'
    '</w:sectPr>'
)


def paragraph(text: str, style: str | None = None, align: str | None = None) -> str:
    props = ""
    if style or align:
        inner = f'<w:pStyle w:val="{style}"/>' if style else ""
        inner += f'<w:jc w:val="{align}"/>' if align else ""
        props = f"<w:pPr>{inner}</w:pPr>"
    return f"<w:p>{props}<w:r><w:t xml:space=\"preserve\">{escape(text)}</w:t></w:r></w:p>"


def picture(image_name: str, width_emu: int, height_emu: int, description: str) -> str:
    drawing = (
        "<w:drawing><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\">"
        f"<wp:extent cx=\"{width_emu}\" cy=\"{height_emu}\"/>"
        "<wp:effectExtent l=\"0\" t=\"0\" r=\"0\" b=\"0\"/>"
        f"<wp:docPr id=\"1\" name=\"Picture 1\" descr=\"{escape(description)}\"/>"
        "<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect=\"1\"/></wp:cNvGraphicFramePr>"
        "<a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\">"
        "<pic:pic><pic:nvPicPr>"
        f"<pic:cNvPr id=\"1\" name=\"{escape(image_name)}\"/><pic:cNvPicPr/></pic:nvPicPr>"
        "<pic:blipFill><a:blip r:embed=\"rId2\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>"
        "<pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/>"
        f"<a:ext cx=\"{width_emu}\" cy=\"{height_emu}\"/></a:xfrm>"
        "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr>"
        "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>"
    )
    return f"<w:p><w:pPr><w:jc w:val=\"center\"/></w:pPr><w:r>{drawing}</w:r></w:p>"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--intro", action="append", default=[])
    parser.add_argument("--caption", default="")
    parser.add_argument("--meta", action="append", default=[], help="key=value rows listed under 测试信息")
    parser.add_argument("--note", action="append", default=[])
    parser.add_argument("--width-inches", type=float, default=5.5)
    args = parser.parse_args()

    image_path = Path(args.image).resolve()
    out_path = Path(args.out).resolve()
    with Image.open(image_path) as probe:
        pixels_w, pixels_h = probe.size
        image_format = (probe.format or "PNG").upper()
    ext = "jpeg" if image_format in {"JPEG", "JPG"} else "png"

    width_emu = int(args.width_inches * EMU_PER_INCH)
    height_emu = int(width_emu * pixels_h / pixels_w)

    digest = hashlib.sha256(image_path.read_bytes()).hexdigest()

    body = [paragraph(args.title, style="Heading1")]
    body += [paragraph(text) for text in args.intro]
    body.append(picture(image_path.name, width_emu, height_emu, args.caption or image_path.name))
    if args.caption:
        body.append(paragraph(args.caption, style="Caption"))

    if args.meta:
        body.append(paragraph("测试信息", style="Heading1"))
        rows = list(args.meta) + [
            f"源图片={image_path.name}",
            f"像素尺寸={pixels_w}x{pixels_h}",
            f"图片格式={image_format}",
            f"嵌入显示尺寸={args.width_inches}in x {round(width_emu and height_emu / EMU_PER_INCH, 2)}in",
            f"源文件字节={image_path.stat().st_size}",
            f"SHA256={digest}",
            f"文档生成时间(UTC)={_dt.datetime.now(_dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
        ]
        body += [paragraph(row, style="Meta") for row in rows]

    body += [paragraph(text, style="Meta") for text in args.note]
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f"<w:document {NS}><w:body>{''.join(body)}{SECT_PR}</w:body></w:document>\n"
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("[Content_Types].xml", CONTENT_TYPES)
        package.writestr("_rels/.rels", ROOT_RELS)
        package.writestr("word/_rels/document.xml.rels", DOC_RELS.format(ext=ext))
        package.writestr("word/styles.xml", STYLES)
        package.writestr("word/document.xml", document)
        package.writestr(f"word/media/image1.{ext}", image_path.read_bytes())

    print(f"wrote {out_path} ({out_path.stat().st_size} bytes)")
    print(f"embedded {image_path.name} {pixels_w}x{pixels_h} at {width_emu}x{height_emu} EMU")


if __name__ == "__main__":
    main()
