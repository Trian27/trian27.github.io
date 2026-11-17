// Browser check for the site's layout and behavior. Loads index.html from disk in headless Chrome through the
// DevTools protocol and verifies the approved design: the navigation tree's geometry, the highlighted branch and the
// header fold, a sidebar that stays in view on every desktop window (scrolling inside itself when the window is too short
// to show all of it), the sidebar figure, the phone layout, and the page with
// JavaScript disabled. Prints one PASS/FAIL line per behavior and exits non-zero on any failure.
//
// Usage: node scripts/check_layout.mjs   (needs CHROME_PATH in .env; see .env.example)
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE_URL = pathToFileURL(join(ROOT, "index.html")).href;

const DESKTOP = { width: 1440, height: 900, mobile: false };
const SHORT_WINDOW = { width: 1280, height: 720, mobile: false };
// Tall enough to show the whole sidebar without it scrolling inside itself.
const TALL_WINDOW = { width: 1440, height: 1320, mobile: false };
const PHONE = { width: 390, height: 844, mobile: true };
// The narrowest phones still in use.
const NARROW_PHONE = { width: 320, height: 640, mobile: true };
// Smallest gap between navigation labels on phones, in CSS pixels.
const MIN_LABEL_GAP = 8;
// Sidebar column width on desktop (--sidebar-width in assets/styles.css); phones cap the figure at it.
const DESKTOP_SIDEBAR_WIDTH = 252;
// Alignment tolerance in CSS pixels.
const TOLERANCE = 1.5;
// Far enough down for the header to fold and the sidebar to stick.
const STUCK_SCROLL = 700;
const SETTLE_MS = 400;
const STARTUP_TIMEOUT_MS = 10000;
// Chrome helpers can finish writing the profile after the main process exits.
const PROFILE_CLEANUP_RETRIES = 3;
const NAV_LEAVES = ["About", "Research", "Honors & Awards", "Community", "CV"];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const near = (a, b) => Math.abs(a - b) <= TOLERANCE;
const center = box => box.left + box.width / 2;

// Everything the checks need from the page, measured in one pass. Reports missing structure instead of throwing.
const MEASURE = `(() => {
  const required = {
    header: ".tree-header", nav: ".tree-nav", gap: ".name-gap", profile: ".profile", aboutHeading: "#about-heading",
    aboutText: ".about-main p:last-of-type", interests: ".sidebar-note > p:last-of-type", dynamics: "[data-learning-dynamics]",
  };
  const found = Object.fromEntries(Object.entries(required).map(([key, selector]) => [key, document.querySelector(selector)]));
  const missing = Object.keys(required).filter(key => !found[key]).map(key => required[key]);
  if (missing.length) return { missing };
  const box = element => {
    if (!element) return null;
    const { left, right, top, bottom, width } = element.getBoundingClientRect();
    return { left, right, top, bottom, width };
  };
  const { header, nav } = found;
  const navBox = box(nav);
  const root = nav.querySelector(".nav-root");
  return {
    rule: navBox,
    gap: box(found.gap),
    rootX: root ? navBox.left + Number(root.getAttribute("cx")) : null,
    labels: [...nav.querySelectorAll("ul a")].map(link => ({ text: link.textContent.trim(), ...box(link) })),
    linksResolve: [...nav.querySelectorAll("ul a")].every(link => !link.hash || document.querySelector(link.hash)),
    nodes: nav.querySelectorAll(".nav-node").length,
    active: nav.querySelector("ul a[aria-current]")?.textContent.trim() ?? null,
    compact: document.documentElement.classList.contains("is-compact"),
    headerHeight: header.offsetHeight,
    headerPosition: getComputedStyle(header).position,
    headerBottom: header.getBoundingClientRect().bottom,
    profilePosition: getComputedStyle(found.profile).position,
    profileScrolls: found.profile.scrollHeight > found.profile.clientHeight
      && getComputedStyle(found.profile).overflowY === "auto",
    profile: box(found.profile),
    aboutHeading: box(found.aboutHeading),
    aboutText: box(found.aboutText),
    interests: box(found.interests),
    figure: box(found.dynamics),
    simplex: box(document.querySelector(".simplex")),
    simplexPoints: document.querySelector(".simplex-path")?.getAttribute("d").split("L").length ?? 0,
    dynamicsHidden: found.dynamics.hidden,
    viewport: { width: innerWidth, height: innerHeight },
    pageWidth: document.documentElement.scrollWidth,
  };
})()`;

const results = [];

/** Records and prints one behavior check; `detail` explains a failure. */
function check(name, passed, detail) {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${passed ? "" : `: ${detail}`}`);
}

/** Reads CHROME_PATH from .env, explaining how to fix a missing file or setting. */
function loadChromePath() {
  try {
    process.loadEnvFile(join(ROOT, ".env"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Missing .env: copy .env.example to .env and set CHROME_PATH to a Chrome or Chromium binary.");
    }
    throw error;
  }
  if (!process.env.CHROME_PATH) throw new Error("CHROME_PATH is empty in .env; see .env.example.");
  return process.env.CHROME_PATH;
}

/** Waits for Chrome to write the DevTools port it chose into the profile directory. */
async function waitForDevToolsPort(profile) {
  const file = join(profile, "DevToolsActivePort");
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const port = Number(readFileSync(file, "utf8").split("\n")[0]);
      if (port > 0) return port;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await sleep(100);
  }
  throw new Error(`Chrome did not open a DevTools port within ${STARTUP_TIMEOUT_MS} ms; check CHROME_PATH in .env.`);
}

/** Starts headless Chrome with a throwaway profile; `close()` stops it and deletes the profile. */
async function launchChrome(chromePath) {
  const profile = mkdtempSync(join(tmpdir(), "site-layout-"));
  const chrome = spawn(chromePath, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--hide-scrollbars",
    "--no-first-run", "--no-default-browser-check", "about:blank",
  ], { stdio: "ignore" });
  const startFailed = once(chrome, "error").then(([error]) => {
    throw new Error(`Could not start Chrome at CHROME_PATH=${chromePath}: ${error.message}`);
  });
  const close = async () => {
    if (chrome.exitCode === null) {
      chrome.kill();
      await once(chrome, "exit");
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: PROFILE_CLEANUP_RETRIES });
  };
  try {
    return { port: await Promise.race([startFailed, waitForDevToolsPort(profile)]), close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Connects to Chrome's page target and returns a small DevTools client that also collects page errors. */
async function connect(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find(target => target.type === "page");
  if (!page) throw new Error("Chrome started without a page to drive.");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error(`Could not open Chrome's DevTools socket on port ${port}.`));
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  const pageErrors = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id !== undefined) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
      return;
    }
    const { method, params } = message;
    if (method === "Runtime.exceptionThrown") {
      pageErrors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
    } else if (method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(params.type)) {
      pageErrors.push(params.args.map(arg => arg.value ?? arg.description).join(" "));
    } else if (method === "Log.entryAdded" && params.entry.level === "error") {
      pageErrors.push(`${params.entry.text} ${params.entry.url ?? ""}`.trim());
    }
    listeners.forEach(listener => listener(message));
  };

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, message => (message.error
      ? reject(new Error(`DevTools ${method} failed: ${message.error.message}`))
      : resolve(message.result)));
    socket.send(JSON.stringify({ id, method, params }));
  });
  const nextEvent = method => new Promise(resolve => {
    const listener = message => {
      if (message.method !== method) return;
      listeners.delete(listener);
      resolve(message.params);
    };
    listeners.add(listener);
  });

  await Promise.all([send("Page.enable"), send("Runtime.enable"), send("Log.enable")]);
  return { send, nextEvent, pageErrors, close: () => socket.close() };
}

/** Loads the page fresh at a viewport size, optionally with JavaScript disabled. */
async function open(cdp, viewport, { javascript = true } = {}) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { deviceScaleFactor: 1, ...viewport });
  await cdp.send("Emulation.setScriptExecutionDisabled", { value: !javascript });
  const loaded = cdp.nextEvent("Page.loadEventFired");
  await cdp.send("Page.navigate", { url: PAGE_URL });
  await loaded;
  await sleep(SETTLE_MS);
}

/** Evaluates an expression in the page and returns its JSON value. */
async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails) {
    throw new Error(`Page expression failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
  }
  return result.value;
}

/** Measures the page; records a failure naming the missing elements and returns null if its structure is wrong. */
async function measurePage(cdp, scenario) {
  const measured = await evaluate(cdp, MEASURE);
  if (!measured.missing) return measured;
  check(`${scenario}: page has the expected structure`, false, `missing ${measured.missing.join(", ")}`);
  return null;
}

/** Scrolls the window, gives scroll handlers a moment, and measures. */
async function measureAfter(cdp, scenario, scrollExpression) {
  await evaluate(cdp, scrollExpression);
  await sleep(SETTLE_MS);
  return measurePage(cdp, scenario);
}

async function checkDesktop(cdp) {
  await open(cdp, DESKTOP);
  const top = await measurePage(cdp, "desktop");
  if (!top) return;
  if (top.labels.map(label => label.text).join() !== NAV_LEAVES.join()) {
    check("tree has the five leaves in order", false, `found ${top.labels.map(label => label.text).join(", ")}`);
    return;
  }
  check("tree has the five leaves in order", true);
  const [about, research, honors, community, cv] = top.labels;
  const gapCenter = top.gap ? center(top.gap) : NaN;
  check("root node sits under the space between the names", top.rootX !== null && near(top.rootX, gapCenter),
    `root ${top.rootX}, name gap ${gapCenter}`);
  check("root node is centered on the page", top.rootX !== null && near(top.rootX, top.viewport.width / 2),
    `root ${top.rootX}, page center ${top.viewport.width / 2}`);
  check("About is flush with the left end of the rule", near(about.left, top.rule.left),
    `label ${about.left}, rule ${top.rule.left}`);
  check("CV is flush with the right end of the rule", near(cv.right, top.rule.right),
    `label ${cv.right}, rule ${top.rule.right}`);
  check("Honors sits directly under the root", near(center(honors), top.viewport.width / 2),
    `Honors ${center(honors)}, page center ${top.viewport.width / 2}`);
  check("middle leaves are evenly spaced",
    near(center(honors) - center(research), center(community) - center(honors)),
    `${center(honors) - center(research)} vs ${center(community) - center(honors)}`);
  check("five leaf nodes are drawn", top.nodes === NAV_LEAVES.length, `${top.nodes} nodes`);
  check("About is highlighted at the top of the page", top.active === "About", `active ${top.active}`);
  check("learning-dynamics figure is drawn", top.dynamicsHidden === false && top.simplexPoints > 100,
    `hidden ${top.dynamicsHidden}, ${top.simplexPoints} points`);
  check("figure sits under the research interests in the sidebar",
    top.figure.top >= top.interests.bottom && top.figure.left >= top.profile.left - TOLERANCE
      && top.figure.right <= top.profile.right + TOLERANCE,
    `figure ${top.figure.top}-${top.figure.right}, interests bottom ${top.interests.bottom}, sidebar right ${top.profile.right}`);
  check("no horizontal overflow on desktop", top.pageWidth <= top.viewport.width, `page ${top.pageWidth}px`);

  const stuck = await measureAfter(cdp, "desktop", `window.scrollTo(0, ${STUCK_SCROLL})`);
  check("header folds after scrolling", stuck.compact && stuck.headerHeight < top.headerHeight,
    `compact ${stuck.compact}, ${top.headerHeight}px → ${stuck.headerHeight}px`);
  await checkSidebarInView(cdp, stuck, "a 900px window");

  const atResearch = await measureAfter(cdp, "desktop", `document.getElementById("research").scrollIntoView()`);
  check("Research is highlighted when in view", atResearch.active === "Research", `active ${atResearch.active}`);
  const atBottom = await measureAfter(cdp, "desktop", "window.scrollTo(0, document.documentElement.scrollHeight)");
  check("Community is highlighted at the bottom", atBottom.active === "Community", `active ${atBottom.active}`);
}

/** Checks that a scrolled-down desktop page keeps the sidebar stuck under the header and fully on screen, and that
 *  scrolling inside the sidebar brings its learning-dynamics figure into view. */
async function checkSidebarInView(cdp, stuck, window) {
  check(`sidebar stays in view under the header in ${window}`,
    stuck.profilePosition === "sticky" && stuck.profile.top >= stuck.headerBottom - TOLERANCE
      && stuck.profile.bottom <= stuck.viewport.height + TOLERANCE,
    `position ${stuck.profilePosition}, sidebar ${stuck.profile.top}-${stuck.profile.bottom}, header bottom ${stuck.headerBottom}`);
  const scrolled = await measureAfter(cdp, window, `document.querySelector(".profile").scrollTop = 1e6`);
  if (!scrolled) return;
  check(`scrolling the sidebar reveals its figure in ${window}`,
    stuck.profileScrolls && scrolled.figure.bottom <= scrolled.profile.bottom + TOLERANCE,
    `sidebar scrolls ${stuck.profileScrolls}, figure bottom ${scrolled.figure.bottom}, sidebar bottom ${scrolled.profile.bottom}`);
}

async function checkShortWindow(cdp) {
  await open(cdp, SHORT_WINDOW);
  const stuck = await measureAfter(cdp, "short window", `window.scrollTo(0, ${STUCK_SCROLL})`);
  if (stuck) await checkSidebarInView(cdp, stuck, "a 720px window");
}

async function checkTallWindow(cdp) {
  await open(cdp, TALL_WINDOW);
  const stuck = await measureAfter(cdp, "tall window", `window.scrollTo(0, ${STUCK_SCROLL})`);
  if (!stuck) return;
  check("sidebar stays in view and fits without scrolling in a 1320px window",
    stuck.profilePosition === "sticky" && !stuck.profileScrolls && stuck.profile.top >= 0
      && stuck.profile.bottom <= stuck.viewport.height,
    `position ${stuck.profilePosition}, scrolls ${stuck.profileScrolls}, sidebar ${stuck.profile.top}-${stuck.profile.bottom}`);
}

/** Checks that the navigation labels in a phone measurement keep at least MIN_LABEL_GAP between neighbors. */
function checkLabelGaps(measured, device) {
  const gaps = measured.labels.slice(1).map((label, i) => Math.round(label.left - measured.labels[i].right));
  check(`navigation labels keep ${MIN_LABEL_GAP}px apart on ${device}`, Math.min(...gaps) >= MIN_LABEL_GAP,
    `gaps ${gaps.join(", ")}`);
}

async function checkPhone(cdp) {
  await open(cdp, PHONE);
  const phone = await measurePage(cdp, "phone");
  if (!phone) return;
  check("header scrolls away on phones", phone.headerPosition === "static", `position ${phone.headerPosition}`);
  check("root node sits under the name gap on phones", phone.rootX !== null && near(phone.rootX, center(phone.gap)),
    `root ${phone.rootX}, gap ${center(phone.gap)}`);
  check("figure follows the research interests on phones, no wider than the desktop sidebar",
    phone.figure.width > 0 && phone.figure.top >= phone.interests.bottom && phone.figure.width <= DESKTOP_SIDEBAR_WIDTH + TOLERANCE,
    `figure ${phone.figure.width}px wide at ${phone.figure.top}, interests bottom ${phone.interests.bottom}`);
  checkLabelGaps(phone, "a 390px phone");
  await open(cdp, NARROW_PHONE);
  const narrow = await measurePage(cdp, "narrow phone");
  if (narrow) checkLabelGaps(narrow, "a 320px phone");
  check("no horizontal overflow on phones", phone.pageWidth <= phone.viewport.width, `page ${phone.pageWidth}px`);
}

async function checkWithoutJavaScript(cdp) {
  await open(cdp, DESKTOP, { javascript: false });
  const plain = await measurePage(cdp, "without JavaScript");
  if (!plain) return;
  check("navigation links work without JavaScript",
    plain.labels.length === NAV_LEAVES.length && plain.linksResolve, `${plain.labels.length} links`);
  check("learning-dynamics figure stays hidden without JavaScript", plain.dynamicsHidden === true,
    `hidden ${plain.dynamicsHidden}`);
}

async function main() {
  const chrome = await launchChrome(loadChromePath());
  try {
    const cdp = await connect(chrome.port);
    try {
      await checkDesktop(cdp);
      await checkShortWindow(cdp);
      await checkTallWindow(cdp);
      await checkPhone(cdp);
      check("no console errors with JavaScript on", cdp.pageErrors.length === 0, cdp.pageErrors.join(" | "));
      await checkWithoutJavaScript(cdp);
    } finally {
      cdp.close();
    }
  } finally {
    await chrome.close();
  }
  const failed = results.filter(result => !result.passed).length;
  console.log(failed ? `FAIL: ${failed} of ${results.length} checks failed.` : `PASS: all ${results.length} checks.`);
  process.exitCode = failed ? 1 : 0;
}

main().catch(error => {
  console.error(`check_layout: ${error.message}`);
  process.exitCode = 1;
});
