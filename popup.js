// Doit rester aligné sur DEFAULTS dans content.js.
const DEFAULTS = {
  speed: "normal",
  accelerate: true,
  walls: true,
  ghost: false,
  foodCount: 1,
  growth: 1,
  golden: false,
  obstacles: "none",
  snakeColor: "#3fb950",
  foodColor: "#f0413f",
  cellSize: 26,
  shape: "round",
  trail: false,
  hud: true,
  dim: 0.06,
  blur: false,
  grid: false,
};

// Chaque preset n'écrit que ce qui le caractérise ; le reste garde sa valeur
// par défaut, ce qui évite qu'un mode traîne un réglage d'un autre.
const PRESETS = {
  discret: {},
  classique: { grid: true, dim: 0.35, cellSize: 26 },
  arcade: {
    speed: "fast", foodCount: 3, golden: true, growth: 2,
    trail: true, snakeColor: "#39d0d8", dim: 0.2,
  },
  chaos: {
    speed: "insane", foodCount: 6, golden: true, growth: 3,
    obstacles: "many", walls: false, trail: true,
    snakeColor: "#f85149", cellSize: 18, dim: 0.3,
  },
  zen: {
    speed: "chill", accelerate: false, walls: false, ghost: true,
    foodCount: 4, cellSize: 34, shape: "circle",
    snakeColor: "#a371f7", dim: 0.15,
  },
  disco: {
    snakeColor: "rainbow", trail: true, shape: "circle",
    foodCount: 3, speed: "fast", dim: 0.45, blur: true,
  },
};

const BOOLS = ["accelerate", "walls", "ghost", "golden", "trail", "hud", "grid", "blur"];
const SELECTS = ["speed", "obstacles", "shape"];
const RANGES = ["foodCount", "growth", "dim"];

const $ = (id) => document.getElementById(id);
const playBtn = $("play");
const hint = $("hint");

let current = { ...DEFAULTS };
let activeTabId = null;

// --- état initial -----------------------------------------------------------

chrome.storage.local.get(["settings", "highScore"], (res) => {
  current = { ...DEFAULTS, ...(res.settings || {}) };
  fillForm();
  $("best").textContent = res.highScore || 0;
});

chrome.commands.getAll().then((cmds) => {
  const cmd = cmds.find((c) => c.name === "toggle-snake");
  hint.textContent = cmd?.shortcut
    ? `Ou ${cmd.shortcut} depuis n'importe quelle page.`
    : "Aucun raccourci défini.";
});

// Une page interne (chrome://, Web Store, PDF) n'accepte aucun content script :
// on le détecte en pinguant plutôt qu'en devinant depuis l'URL.
chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  if (!tab?.id) return;
  activeTabId = tab.id;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "SNAKE_PING" });
    if (res?.open) playBtn.textContent = "Fermer le jeu";
  } catch {
    playBtn.disabled = true;
    playBtn.textContent = "Impossible sur cette page";
    hint.textContent =
      "Les pages internes du navigateur sont hors de portée. Essaie sur un site.";
  }
});

// --- formulaire -------------------------------------------------------------

function fillForm() {
  for (const id of BOOLS) $(id).checked = current[id];
  for (const id of SELECTS) $(id).value = current[id];
  for (const id of RANGES) $(id).value = current[id];
  $("cellSize").value = String(current.cellSize);
  $("foodColor").value = current.foodColor;
  $("snakeCustom").value =
    current.snakeColor === "rainbow" ? DEFAULTS.snakeColor : current.snakeColor;
  paintSwatches();
  paintOutputs();
}

function paintSwatches() {
  for (const sw of document.querySelectorAll(".sw")) {
    sw.setAttribute("aria-pressed", sw.dataset.color === current.snakeColor);
  }
  const rainbow = current.snakeColor === "rainbow";
  const accent = rainbow ? DEFAULTS.snakeColor : current.snakeColor;
  document.documentElement.style.setProperty("--accent", accent);
  // La pastille du titre sert d'apercu de la couleur choisie.
  $("dot").style.background = rainbow
    ? "conic-gradient(#f85149, #e3b341, #3fb950, #39d0d8, #a371f7, #f778ba, #f85149)"
    : accent;
}

function paintOutputs() {
  $("foodCountOut").textContent = current.foodCount;
  $("growthOut").textContent = `+${current.growth}`;
  $("dimOut").textContent = Math.round(current.dim * 100) + "%";
}

function readForm() {
  for (const id of BOOLS) current[id] = $(id).checked;
  for (const id of SELECTS) current[id] = $(id).value;
  current.foodCount = parseInt($("foodCount").value, 10);
  current.growth = parseInt($("growth").value, 10);
  current.dim = parseFloat($("dim").value);
  current.cellSize = parseInt($("cellSize").value, 10);
  current.foodColor = $("foodColor").value;
}

function save() {
  chrome.storage.local.set({ settings: current });
}

function onInput() {
  readForm();
  paintOutputs();
  save();
}

for (const id of [...BOOLS, ...SELECTS, "cellSize"]) {
  $(id).addEventListener("change", onInput);
}
for (const id of [...RANGES, "foodColor"]) {
  $(id).addEventListener("input", onInput);
}

// --- couleur du serpent -----------------------------------------------------

for (const sw of document.querySelectorAll(".sw")) {
  sw.addEventListener("click", () => {
    current.snakeColor = sw.dataset.color;
    paintSwatches();
    save();
  });
}

$("snakeCustom").addEventListener("input", (e) => {
  current.snakeColor = e.target.value;
  paintSwatches();
  save();
});

// --- presets ----------------------------------------------------------------

for (const btn of document.querySelectorAll(".preset")) {
  btn.addEventListener("click", () => {
    current = { ...DEFAULTS, ...PRESETS[btn.dataset.preset] };
    fillForm();
    save();
  });
}

// --- pied de page -----------------------------------------------------------

playBtn.addEventListener("click", async () => {
  if (!activeTabId) return;
  try {
    await chrome.tabs.sendMessage(activeTabId, { type: "SNAKE_TOGGLE" });
    window.close(); // le popup vole le focus clavier : il doit disparaître
  } catch {
    playBtn.disabled = true;
    playBtn.textContent = "Impossible sur cette page";
  }
});

$("shortcut").addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

$("reset").addEventListener("click", () => {
  current = { ...DEFAULTS };
  fillForm();
  save();
});

$("clear").addEventListener("click", () => {
  chrome.storage.local.set({ highScore: 0 });
  $("best").textContent = "0";
});
