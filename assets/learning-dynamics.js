// Learning-dynamics figure in the About section: replicator dynamics in a generalized rock–paper–scissors game, drawn
// on the strategy simplex. A win pays more than a loss costs, so the mixed equilibrium (each move ⅓ of the time) is
// stable, and play that starts from a skewed mix spirals into it. The caption lives in index.html; this script draws
// the curve and reveals the figure, which stays hidden without JavaScript.
(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const WIN_PAYOFF = 1.6;
  const LOSS_PAYOFF = -1;
  // Payoff to the row move against the column move, in the order rock, paper, scissors.
  const PAYOFFS = [
    [0, LOSS_PAYOFF, WIN_PAYOFF],
    [WIN_PAYOFF, 0, LOSS_PAYOFF],
    [LOSS_PAYOFF, WIN_PAYOFF, 0],
  ];
  const START_MIX = [0.82, 0.12, 0.06];
  const EQUILIBRIUM = [1 / 3, 1 / 3, 1 / 3];
  // Euler steps of the replicator equation; every SAMPLE_EVERY-th state becomes a point on the drawn path.
  const STEP_SIZE = 0.01;
  const STEPS = 4400;
  const SAMPLE_EVERY = 8;
  // Triangle side and padding for the vertex labels, in SVG units.
  const SIDE = 150;
  const PAD = 14;
  // Vertex label, x/y offset from its corner, and text anchor, in corner order R, P, S.
  const VERTEX_LABELS = [["R", -5, 4, "end"], ["P", 5, 4, "start"], ["S", 0, -5, "middle"]];
  const START_RADIUS = 2.4;
  const EQUILIBRIUM_RADIUS = 3;

  /** Population mixes (x_R, x_P, x_S) along the replicator path from START_MIX, sampled every SAMPLE_EVERY steps. */
  function replicatorTrajectory() {
    let mix = START_MIX;
    const points = [mix];
    for (let step = 1; step <= STEPS; step++) {
      const fitness = PAYOFFS.map(row => row.reduce((sum, payoff, j) => sum + payoff * mix[j], 0));
      const mean = mix.reduce((sum, share, i) => sum + share * fitness[i], 0);
      mix = mix.map((share, i) => share + STEP_SIZE * share * (fitness[i] - mean));
      if (step % SAMPLE_EVERY === 0) points.push(mix);
    }
    return points;
  }

  function svgElement(tag, attrs, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    parent?.appendChild(node);
    return node;
  }

  /** Builds the figure: the simplex, its vertex labels, the replicator path, its start, and the equilibrium. */
  function drawSimplex() {
    const height = SIDE * Math.sqrt(3) / 2;
    const corners = [[PAD, PAD + height], [PAD + SIDE, PAD + height], [PAD + SIDE / 2, PAD]];
    const toPoint = mix => [0, 1].map(axis => mix.reduce((sum, share, i) => sum + share * corners[i][axis], 0));
    const svg = svgElement("svg", {
      class: "simplex",
      viewBox: `0 0 ${SIDE + 2 * PAD} ${height + 2 * PAD}`,
      role: "img",
      "aria-label": "Replicator dynamics in rock–paper–scissors spiralling into the mixed equilibrium",
    });
    svgElement("path", { class: "simplex-edge", d: `M${corners.map(corner => corner.join(" ")).join("L")}Z` }, svg);
    VERTEX_LABELS.forEach(([label, dx, dy, anchor], i) => {
      const text = svgElement("text", { class: "simplex-vertex", x: corners[i][0] + dx, y: corners[i][1] + dy, "text-anchor": anchor }, svg);
      text.textContent = label;
    });
    const points = replicatorTrajectory().map(toPoint);
    svgElement("path", {
      class: "simplex-path",
      pathLength: 1,
      d: `M${points.map(point => point.map(value => value.toFixed(1)).join(" ")).join("L")}`,
    }, svg);
    svgElement("circle", { class: "simplex-start", cx: points[0][0], cy: points[0][1], r: START_RADIUS }, svg);
    const [cx, cy] = toPoint(EQUILIBRIUM);
    svgElement("circle", { class: "simplex-eq", cx, cy, r: EQUILIBRIUM_RADIUS }, svg);
    return svg;
  }

  const figure = document.querySelector("[data-learning-dynamics]");
  if (!figure) return;
  figure.prepend(drawSimplex());
  figure.hidden = false;
})();
