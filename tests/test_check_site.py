"""Behavior tests for scripts/check_site.py: page validation and the placeholder report."""

import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import check_site  # noqa: E402

PAGE_WITH_PLACEHOLDERS = """<!doctype html><html><body id="top"><main>
<h1>Name</h1><h2 id="about">About</h2>
<p><a href="#about">About</a> with <span class="fill-in">names to add</span></p>
<p><span class="paper-meta fill-in">arXiv <em>link</em></span> <br></p>
<img src="portrait.jpg" alt="Portrait" width="10" height="10">
</main></body></html>"""

COMPLETE_PAGE = PAGE_WITH_PLACEHOLDERS.replace('<span class="fill-in">names to add</span>', "Ada Lovelace").replace(
    '<span class="paper-meta fill-in">arXiv <em>link</em></span>', '<a href="https://arxiv.org/abs/0000.00000">arXiv</a>'
)


class SiteTestCase(unittest.TestCase):
    """Builds a throwaway site directory holding one page and its portrait."""

    def make_site(self, page):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        (root / "index.html").write_text(page, encoding="utf-8")
        (root / ".nojekyll").touch()
        (root / "portrait.jpg").write_bytes(b"")
        return root


class AuditSiteTests(SiteTestCase):
    def test_complete_page_has_no_errors_or_placeholders(self):
        report = check_site.audit_site(self.make_site(COMPLETE_PAGE))
        self.assertEqual(report.errors, [])
        self.assertEqual(report.placeholders, [])

    def test_placeholders_are_listed_in_page_order_including_nested_text(self):
        report = check_site.audit_site(self.make_site(PAGE_WITH_PLACEHOLDERS))
        self.assertEqual(report.placeholders, ["names to add", "arXiv link"])
        self.assertEqual(report.errors, [])

    def test_missing_anchor_target_is_an_error(self):
        report = check_site.audit_site(self.make_site(COMPLETE_PAGE.replace('href="#about"', 'href="#missing"')))
        self.assertIn("Missing anchor target: #missing", report.errors)

    def test_skipped_heading_level_is_an_error(self):
        report = check_site.audit_site(self.make_site(COMPLETE_PAGE.replace("<h2", "<h3").replace("</h2>", "</h3>")))
        self.assertIn("Heading levels skip from h1 to h3.", report.errors)

    def test_missing_page_raises_with_a_fix(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        with self.assertRaisesRegex(FileNotFoundError, "index.html is missing"):
            check_site.audit_site(Path(directory.name))


class MainTests(SiteTestCase):
    def run_main(self, root, *args):
        output = io.StringIO()
        with mock.patch.object(check_site, "ROOT", root), contextlib.redirect_stdout(output):
            status = check_site.main(list(args))
        return status, output.getvalue()

    def test_placeholders_are_reported_without_failing_by_default(self):
        status, output = self.run_main(self.make_site(PAGE_WITH_PLACEHOLDERS))
        self.assertEqual(status, 0)
        self.assertIn("TODO: 2 placeholders to fill in before publishing", output)
        self.assertIn("- names to add", output)
        self.assertIn("PASS:", output)

    def test_strict_mode_fails_while_placeholders_remain(self):
        status, output = self.run_main(self.make_site(PAGE_WITH_PLACEHOLDERS), "--strict")
        self.assertEqual(status, 1)
        self.assertIn("FAIL: 2 placeholders to fill in before publishing", output)

    def test_strict_mode_passes_once_placeholders_are_filled(self):
        status, output = self.run_main(self.make_site(COMPLETE_PAGE), "--strict")
        self.assertEqual(status, 0)
        self.assertNotIn("placeholder", output)

    def test_page_errors_fail_even_without_strict_mode(self):
        status, output = self.run_main(self.make_site(COMPLETE_PAGE.replace('href="#about"', 'href="#missing"')))
        self.assertEqual(status, 1)
        self.assertIn("Missing anchor target: #missing", output)

    def test_missing_page_fails_with_a_fix(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        status, output = self.run_main(Path(directory.name))
        self.assertEqual(status, 1)
        self.assertIn("index.html is missing", output)


if __name__ == "__main__":
    unittest.main()
