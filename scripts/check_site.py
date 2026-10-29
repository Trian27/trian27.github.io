"""Validate the static website's navigation, local assets, and basic semantics, and list unfinished placeholders.

Run ``python3 scripts/check_site.py`` while editing. Before publishing, add ``--strict`` to also fail while any
element with the ``fill-in`` class (text still to be supplied) remains in index.html.
"""

import argparse
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
PLACEHOLDER_CLASS = "fill-in"
EXTERNAL_SCHEMES = {"https", "mailto", "data"}
# Elements without end tags, which must not deepen the placeholder nesting count.
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}


class SiteParser(HTMLParser):
    """Collect resource references, document landmarks, and placeholder text without dependencies."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.references = []
        self.images = []
        self.headings = []
        self.main_count = 0
        self.errors = []
        self.placeholders = []
        self._placeholder_depth = 0  # open elements inside the current placeholder, including itself

    def handle_starttag(self, tag, attrs):
        """Record attributes used to validate navigation and accessibility, and open placeholders."""
        attributes = dict(attrs)
        if "id" in attributes:
            self.ids.append(attributes["id"])
        if tag in {"a", "link"}:
            self.references.append(attributes.get("href", ""))
        if tag in {"img", "script"}:
            self.references.append(attributes.get("src", ""))
        if tag == "img":
            self.images.append(attributes)
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self.headings.append(int(tag[1]))
        if tag == "main":
            self.main_count += 1
        if tag == "a" and attributes.get("target") == "_blank":
            if "noopener" not in attributes.get("rel", "").split():
                self.errors.append("New-tab links need rel=\"noopener\".")
        if tag in VOID_TAGS:
            return
        if self._placeholder_depth:
            self._placeholder_depth += 1
        elif PLACEHOLDER_CLASS in (attributes.get("class") or "").split():
            self._placeholder_depth = 1
            self.placeholders.append("")

    def handle_endtag(self, tag):
        """Close one level of the current placeholder, if any."""
        if self._placeholder_depth and tag not in VOID_TAGS:
            self._placeholder_depth -= 1

    def handle_data(self, data):
        """Collect the text of the current placeholder."""
        if self._placeholder_depth:
            self.placeholders[-1] += data


@dataclass
class SiteReport:
    """Result of auditing a site: blocking errors, unfinished placeholder text, and counts for the summary line."""

    errors: list
    placeholders: list
    reference_count: int
    anchor_count: int


def audit_site(root):
    """Check ``root/index.html`` and everything it references; raise FileNotFoundError if the page is missing."""
    entry = root / "index.html"
    if not entry.is_file():
        raise FileNotFoundError(f"index.html is missing from {root}; create the static site first.")

    parser = SiteParser()
    parser.feed(entry.read_text(encoding="utf-8"))
    errors = parser.errors
    ids = set(parser.ids)
    if len(ids) != len(parser.ids):
        errors.append("Document contains duplicate IDs.")
    if parser.main_count != 1:
        errors.append("Document needs exactly one main landmark.")
    if parser.headings.count(1) != 1:
        errors.append("Document needs exactly one h1.")
    for previous, current in zip(parser.headings, parser.headings[1:]):
        if current > previous + 1:
            errors.append(f"Heading levels skip from h{previous} to h{current}.")

    for reference in parser.references:
        if not reference:
            errors.append("An asset or link has an empty destination.")
            continue
        parts = urlsplit(reference)
        if parts.scheme or parts.netloc:
            if parts.scheme not in EXTERNAL_SCHEMES:
                errors.append(f"Unexpected link protocol: {reference}")
            continue
        if parts.path.startswith("/"):
            errors.append(f"Root-relative asset breaks project-site paths: {reference}")
        destination = root / unquote(parts.path) if parts.path else entry
        if not destination.is_file():
            errors.append(f"Missing local destination: {reference}")
        if parts.fragment and destination == entry and parts.fragment not in ids:
            errors.append(f"Missing anchor target: {reference}")

    for image in parser.images:
        if not image.get("alt", "").strip():
            errors.append("The portrait needs descriptive alternative text.")
        if not image.get("width") or not image.get("height"):
            errors.append("Images need explicit dimensions to reserve layout space.")
    if not (root / ".nojekyll").is_file():
        errors.append("Missing .nojekyll for plain static GitHub Pages hosting.")
    if list((root / ".github" / "workflows").glob("*")):
        errors.append("Local draft must not include automatic deployment workflows.")

    placeholders = [" ".join(text.split()) for text in parser.placeholders]
    return SiteReport(errors, placeholders, len(parser.references), len(ids))


def main(argv=None):
    """Audit the site in this repository, print the results, and return the process exit status."""
    arguments = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    arguments.add_argument(
        "--strict", action="store_true", help="also fail while fill-in placeholders remain (use before publishing)"
    )
    options = arguments.parse_args(argv)
    try:
        report = audit_site(ROOT)
    except FileNotFoundError as error:
        print(f"FAIL: {error}")
        return 1

    if report.placeholders:
        label = "FAIL" if options.strict else "TODO"
        count = len(report.placeholders)
        print(f"{label}: {count} placeholder{'s' if count != 1 else ''} to fill in before publishing:")
        print("\n".join(f"- {text}" for text in report.placeholders))
    if report.errors:
        print("FAIL:\n" + "\n".join(f"- {error}" for error in report.errors))
        return 1
    if options.strict and report.placeholders:
        return 1
    print(
        f"PASS: {report.reference_count} destinations, {report.anchor_count} anchors, "
        "heading structure, portrait accessibility, and static-site assets."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
