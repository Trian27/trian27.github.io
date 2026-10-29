// Navigation tree in the page header. Draws straight edges from a root node under the space between the first and
// last name to the five section links, highlights the branch to the section in view (an equilibrium path through a
// game tree), and folds the header into a shorter tree with a monogram once the reader scrolls. Without JavaScript the
// links still work on their own; this script only adds the drawing, highlighting, and folding.
(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  // Scroll distance (px) after which the header folds.
  const FOLD_SCROLL = 24;
  // Gaps (px) between the bottom of the name and the root node, and between each leaf node and its label.
  const ROOT_GAP = 8;
  const LEAF_GAP = 10;
  const NODE_RADIUS = 4.5;
  const ACTIVE_NODE_RADIUS = 5.5;
  // CV links to a file rather than a section, so it is drawn as a square terminal node of this side length (px).
  const TERMINAL_SIZE = 9;
  // A section counts as in view once its top passes this fraction of the window below the header.
  const ACTIVE_LINE = 0.25;
  // Distance (px) from the bottom of the page within which the last section counts as in view.
  const BOTTOM_SLACK = 4;

  const html = document.documentElement;
  const header = document.querySelector(".tree-header");
  const nav = header?.querySelector(".tree-nav");
  const svg = nav?.querySelector(".tree-nav-edges");
  const rootLink = nav?.querySelector(".tree-root");
  const nameGap = rootLink?.querySelector(".name-gap");
  if (!svg || !nameGap) {
    console.error("tree-nav.js: the header needs .tree-nav with .tree-nav-edges and a .tree-root containing .name-gap; the navigation tree was not drawn.");
    return;
  }
  const links = [...nav.querySelectorAll("ul a")];
  const tracked = links
    .map(link => [link, link.hash ? document.querySelector(link.hash) : null])
    .filter(([, section]) => section);
  let active = null;
  let hovered = null;

  const isFixed = () => getComputedStyle(header).position === "fixed";

  function add(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.appendChild(node);
    return node;
  }

  /** Redraws every edge and node from the current positions of the name and the link labels. */
  function draw() {
    const box = nav.getBoundingClientRect();
    const rootBox = rootLink.getBoundingClientRect();
    // The root sits under the space between the first and last name; once folded, under the monogram.
    const anchorBox = nameGap.getClientRects().length ? nameGap.getBoundingClientRect() : rootBox;
    const rootX = anchorBox.left - box.left + anchorBox.width / 2;
    const rootY = rootBox.bottom - box.top + ROOT_GAP;
    svg.replaceChildren();

    const state = link => (link === active ? "is-active" : link === hovered ? "is-hover" : "");
    const rank = link => (link === active ? 2 : link === hovered ? 1 : 0);
    const placed = links.map(link => {
      const rect = link.getBoundingClientRect();
      return { link, x: rect.left - box.left + rect.width / 2, y: rect.top - box.top - LEAF_GAP };
    });

    // Highlighted branches are drawn last so they sit on top where edges meet at the root.
    [...placed].sort((a, b) => rank(a.link) - rank(b.link)).forEach(({ link, x, y }) => {
      add("path", { class: `nav-edge ${state(link)}`, d: `M${rootX} ${rootY}L${x} ${y}` });
    });
    placed.forEach(({ link, x, y }) => {
      if (link.hasAttribute("data-terminal")) {
        const half = TERMINAL_SIZE / 2;
        add("rect", { class: `nav-node is-terminal ${state(link)}`, x: x - half, y: y - half, width: TERMINAL_SIZE, height: TERMINAL_SIZE });
      } else {
        add("circle", { class: `nav-node ${state(link)}`, cx: x, cy: y, r: link === active ? ACTIVE_NODE_RADIUS : NODE_RADIUS });
      }
    });
    add("circle", { class: "nav-root", cx: rootX, cy: rootY, r: NODE_RADIUS });
  }

  /** Records both header heights, so the page is padded for the tall header and anchors clear the short one. */
  function measure() {
    html.classList.remove("is-compact");
    if (!isFixed()) return;
    html.style.setProperty("--header-full", `${header.offsetHeight}px`);
    html.classList.add("is-compact");
    html.style.setProperty("--header-h", `${header.offsetHeight}px`);
    html.classList.toggle("is-compact", window.scrollY > FOLD_SCROLL);
  }

  /** Marks the link for the section in view; returns whether it changed. */
  function updateActive() {
    if (!tracked.length) return false;
    const line = header.getBoundingClientRect().bottom + window.innerHeight * ACTIVE_LINE;
    let current = tracked[0][0];
    for (const [link, section] of tracked) if (section.getBoundingClientRect().top <= line) current = link;
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - BOTTOM_SLACK) current = tracked.at(-1)[0];
    if (current === active) return false;
    links.forEach(link => link.removeAttribute("aria-current"));
    current.setAttribute("aria-current", "location");
    active = current;
    return true;
  }

  function onScroll() {
    const wasCompact = html.classList.contains("is-compact");
    html.classList.toggle("is-compact", isFixed() && window.scrollY > FOLD_SCROLL);
    const folded = wasCompact !== html.classList.contains("is-compact");
    if (updateActive() || folded) draw();
  }

  function relayout() {
    measure();
    updateActive();
    draw();
  }

  links.forEach(link => {
    link.addEventListener("pointerenter", () => { hovered = link; draw(); });
    link.addEventListener("pointerleave", () => { hovered = null; draw(); });
    link.addEventListener("focus", () => { hovered = link; draw(); });
    link.addEventListener("blur", () => { hovered = null; draw(); });
  });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", relayout);
  document.fonts?.ready.then(relayout);
  relayout();
})();
