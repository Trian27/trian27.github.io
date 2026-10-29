# Tri-An Nguyen's academic website

A static academic profile emphasizing graduate study in economics and computer science (EconCS), theoretical research, and experimental/empirical work. Built using the supplied research résumé and portrait, with an academic layout inspired by [Xintong Wang's homepage](https://xintongemilywang.github.io/).

The public site is [trian27.github.io](https://trian27.github.io/), hosted by GitHub Pages from the root of the `main` branch in [Trian27/trian27.github.io](https://github.com/Trian27/trian27.github.io).

## Preview locally

Open `index.html` directly in a browser. All site assets are local, and there is no build or installation step.

Alternatively, from this directory run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Visit `http://127.0.0.1:8000/`. Stop the server with Ctrl+C.

## Edit content

All text on the page is in `index.html`, in page order:

- Sidebar (`<aside class="profile">`): name, field, affiliation, contact links, research interests.
- About (`id="about"`): the bio, the learning-dynamics caption, the mixed-strategy formula, and the EconCS statement.
- Recent updates: one `<li>` per update, newest first, with a `<time datetime="YYYY-MM">` date.
- Research (`id="research"`): Ongoing work (project, then "with" and names) and Papers (title, authors, venue, arXiv link).
- Selected honors (`id="honors"`) and Community (`id="community"`).

Text still to be supplied is wrapped in `<span class="fill-in">…</span>`, which shows a dashed outline. Replace the whole span with the real text or link. `python3 scripts/check_site.py` lists what is left.

Other files:

- `assets/styles.css`: typography, colors, and responsive layout.
- `assets/tree-nav.js`: draws the navigation tree and highlights the section in view. Add or rename a section by editing the links in the header `<ul>`; the tree follows.
- `assets/learning-dynamics.js`: draws the rock–paper–scissors simplex. Its caption is in `index.html`.
- `assets/profile.jpg`, `assets/Tri-An_Nguyen_Resume_Research.pdf`, `assets/ANL_2025_Certificate.pdf`, `assets/favicon.svg`: portrait, CV, ANL 2025 award certificate, and icon.

The site uses system fonts and no analytics or external runtime dependencies. JavaScript only enhances the page: without it, every link and all text still work, the tree's edges are not drawn, and the learning-dynamics figure stays hidden. Research summaries and dates come from the supplied résumé. Public GitHub links were checked against [Trian27](https://github.com/Trian27); negotiation links come from the reference homepage. The robotics project is described as **submitted to ICRA 2027**, without claiming acceptance.

## Validate

Create the project environment once with `uv venv --no-python-downloads .venv`; the Python checks use only the standard library.

```sh
.venv/bin/python scripts/check_site.py            # links, anchors, headings, images; lists placeholders
.venv/bin/python scripts/check_site.py --strict   # before publishing: also fails while placeholders remain
.venv/bin/python -m unittest discover -s tests    # tests for the checker
node scripts/check_layout.mjs            # layout and behavior in headless Chrome
```

The layout check needs Node 20.12 or newer and a local Chrome. Copy `.env.example` to `.env` and set `CHROME_PATH`. It verifies the tree geometry (root under the gap in the name, outer labels flush with the rule), section highlighting and the header fold, that the sidebar fits in 900px and 720px tall windows, the About figures, the phone layout, and the page with JavaScript disabled.

## Publish updates

GitHub Pages publishes from `main` and `/(root)`, with no custom deployment workflow. The empty `.nojekyll` file bypasses Jekyll processing. Validate changes, commit them, and push to `origin main` to update the site. GitHub's [publishing-source documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) describes this setup.

To update the CV, replace `assets/Tri-An_Nguyen_Resume_Research.pdf`, keeping the same filename, then commit and push that file. All existing CV links will continue to work.

`.env`, the virtual environment, preview screenshots, and local design notes are ignored by Git.
