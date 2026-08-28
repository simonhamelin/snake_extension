/**
 * Snake Anywhere — overlay de jeu injecté sur n'importe quelle page.
 *
 * Le script est présent sur toutes les pages mais reste inerte : rien n'est
 * créé dans le DOM tant que le joueur n'a pas lancé la partie. Tout le rendu
 * vit dans un shadow root fermé pour que le CSS de la page hôte ne puisse pas
 * le déformer (et inversement).
 */
(() => {
  "use strict";

  if (window.__snakeAnywhere) return;

  const HOST_ID = "snake-anywhere-root";
  const SPEEDS = { chill: 150, normal: 110, fast: 75, insane: 48 };
  const MIN_TICK = 40; // plancher, sinon l'accélération devient injouable
  const GOLD_TTL = 8000; // durée de vie d'un jeton doré, en ms
  const GOLD_CHANCE = 0.18;

  // Doit rester aligné sur DEFAULTS dans popup.js.
  const DEFAULTS = {
    // jeu
    speed: "normal", // chill | normal | fast | insane
    accelerate: true, // le jeu accélère avec le score
    walls: true, // true = mourir au bord, false = ressortir en face
    ghost: false, // traverser son propre corps
    foodCount: 1, // jetons présents en même temps (1 à 8)
    growth: 1, // segments gagnés par jeton (1 à 4)
    golden: false, // jetons dorés : +5 points, mais ils expirent
    obstacles: "none", // none | few | many
    // apparence
    snakeColor: "#3fb950", // hex, ou "rainbow"
    foodColor: "#f0413f",
    cellSize: 26, // 18 | 26 | 34
    shape: "round", // round | square | circle
    trail: false, // halo lumineux sur le serpent
    hud: true, // pastille du score
    dim: 0.06, // voile posé sur la page
    blur: false,
    grid: false, // quadrillage + cadre de l'aire de jeu
  };

  let settings = { ...DEFAULTS };
  let highScore = 0;

  chrome.storage.local.get(["settings", "highScore"], (res) => {
    if (res.settings) settings = { ...DEFAULTS, ...res.settings };
    if (typeof res.highScore === "number") highScore = res.highScore;
    if (game) game.applySettings();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings) settings = { ...DEFAULTS, ...changes.settings.newValue };
    if (changes.highScore) highScore = changes.highScore.newValue || 0;
    if (game) game.applySettings();
  });

  // ---------------------------------------------------------------- couleurs

  const OUTLINE = "rgba(3, 10, 6, 0.6)";

  /** Convertit un hex en HSL : on module ensuite la luminosité, pas l'opacité. */
  function hexToHsl(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
    if (!m) return { h: 133, s: 56, l: 48 };
    const r = parseInt(m[1], 16) / 255;
    const g = parseInt(m[2], 16) / 255;
    const b = parseInt(m[3], 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0;
    let s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return { h, s: s * 100, l: l * 100 };
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---------------------------------------------------------------- styles

  const STYLES = `
    :host { all: initial; }
    .wrap {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: block;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      animation: fade-in 180ms ease-out;
    }
    @keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
    canvas { display: block; width: 100%; height: 100%; }
    .hud {
      position: absolute;
      top: 18px; left: 50%;
      transform: translateX(-50%);
      display: flex; gap: 22px; align-items: baseline;
      padding: 8px 18px;
      border-radius: 999px;
      background: rgba(10, 12, 10, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #e6f5e8;
      font-size: 13px;
      letter-spacing: 0.06em;
      white-space: nowrap;
      pointer-events: none;
    }
    .hud b { font-weight: 600; font-variant-numeric: tabular-nums; }
    .card {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      min-width: 280px;
      padding: 28px 34px;
      border-radius: 16px;
      background: rgba(10, 12, 10, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
      color: #e6f5e8;
      text-align: center;
      pointer-events: none;
    }
    .card h1 { margin: 0 0 6px; font-size: 22px; font-weight: 600; letter-spacing: 0.02em; }
    .card .score { margin: 14px 0 4px; font-size: 44px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .card .sub { margin: 0; font-size: 12px; opacity: 0.62; line-height: 1.8; }
    .card kbd {
      display: inline-block;
      padding: 1px 6px; margin: 0 1px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.16);
      font: inherit; font-size: 11px;
      color: #d8e4da;
    }
    .card .best { margin-top: 12px; font-size: 12px; opacity: 0.5; }
    .hidden { display: none; }
  `;

  // ---------------------------------------------------------------- jeu

  class Game {
    constructor() {
      this.host = document.createElement("div");
      this.host.id = HOST_ID;
      // Le conteneur ne participe pas au flux de la page hôte.
      this.host.style.cssText = "all:initial;position:static;";
      this.shadow = this.host.attachShadow({ mode: "closed" });

      const style = document.createElement("style");
      style.textContent = STYLES;

      this.wrap = document.createElement("div");
      this.wrap.className = "wrap";
      // L'overlay avale les clics : on ne veut pas cliquer la page à travers.
      this.wrap.style.pointerEvents = "auto";

      this.canvas = document.createElement("canvas");
      this.ctx = this.canvas.getContext("2d");

      this.hud = document.createElement("div");
      this.hud.className = "hud";

      this.card = document.createElement("div");
      this.card.className = "card";

      this.wrap.append(this.canvas, this.hud, this.card);
      this.shadow.append(style, this.wrap);
      (document.body || document.documentElement).appendChild(this.host);

      this.onKey = this.onKey.bind(this);
      this.onResize = this.onResize.bind(this);
      this.onVisibility = this.onVisibility.bind(this);
      this.loop = this.loop.bind(this);

      window.addEventListener("keydown", this.onKey, true);
      window.addEventListener("resize", this.onResize);
      document.addEventListener("visibilitychange", this.onVisibility);

      this.chromeKey = null;
      this.resize();
      this.reset();
      this.applySettings();
      this.state = "ready";
      this.raf = requestAnimationFrame(this.loop);
    }

    /**
     * Rejoue tous les réglages d'un coup. Appelé à chaque écriture du popup :
     * la taille des cases redéfinit la grille, donc tout ce qui vit dessus
     * (serpent, jetons, obstacles) doit être revalidé derrière.
     */
    applySettings() {
      this.wrap.style.background = `rgba(6, 8, 6, ${settings.dim})`;
      // `none` et pas une chaîne vide : sur certains moteurs, un backdrop-filter
      // actif force la création d'une couche de composition même à 0px.
      this.wrap.style.backdropFilter = settings.blur ? "blur(3px)" : "none";
      this.hud.classList.toggle("hidden", !settings.hud);

      this.rainbow = settings.snakeColor === "rainbow";
      this.snakeHsl = this.rainbow ? null : hexToHsl(settings.snakeColor);

      // Changer la taille des cases redéfinit la grille, changer le mode
      // obstacles redéfinit leur semis : les deux imposent un nouveau tirage.
      const relayout =
        this.cell !== settings.cellSize || this.obstacleMode !== settings.obstacles;
      this.obstacleMode = settings.obstacles;

      this.resize();
      if (relayout) this.buildObstacles();
      this.clampToGrid();
      this.refillFood();
      this.chromeKey = null; // forcer un redessin du HUD
    }

    destroy() {
      cancelAnimationFrame(this.raf);
      window.removeEventListener("keydown", this.onKey, true);
      window.removeEventListener("resize", this.onResize);
      document.removeEventListener("visibilitychange", this.onVisibility);
      this.host.remove();
    }

    // -- grille ------------------------------------------------------

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      this.cell = settings.cellSize;
      this.cols = Math.max(10, Math.floor(w / this.cell));
      this.rows = Math.max(10, Math.floor(h / this.cell));
      // Marge pour centrer la grille dans la fenêtre.
      this.offX = Math.floor((w - this.cols * this.cell) / 2);
      this.offY = Math.floor((h - this.rows * this.cell) / 2);
    }

    onResize() {
      this.resize();
      this.buildObstacles();
      this.clampToGrid();
      this.refillFood();
    }

    /** Ramène tout dans la grille après un changement de dimensions. */
    clampToGrid() {
      if (!this.snake) return;
      this.snake = this.snake.map((s) => ({
        x: clamp(s.x, 0, this.cols - 1),
        y: clamp(s.y, 0, this.rows - 1),
      }));
      this.foods = (this.foods || []).filter(
        (f) => f.x < this.cols && f.y < this.rows && !this.obstacles.has(key(f))
      );
    }

    onVisibility() {
      if (document.hidden) this.pause();
    }

    pause() {
      if (this.state !== "playing") return;
      this.state = "paused";
      this.pausedAt = performance.now();
    }

    resume() {
      if (this.state === "playing") return;
      // Un jeton dore ne doit pas fondre pendant que la partie est arretee :
      // on decale sa naissance du temps passe hors jeu.
      const now = performance.now();
      const gap = now - (this.pausedAt || now);
      for (const f of this.foods) f.born += gap;
      this.pausedAt = 0;
      this.state = "playing";
      this.last = now;
    }

    // -- état --------------------------------------------------------

    reset() {
      const cx = Math.floor(this.cols / 2);
      const cy = Math.floor(this.rows / 2);
      this.snake = [
        { x: cx, y: cy },
        { x: cx - 1, y: cy },
        { x: cx - 2, y: cy },
      ];
      this.dir = { x: 1, y: 0 };
      this.queue = [];
      this.score = 0;
      this.pending = 0; // segments restant à faire pousser
      this.acc = 0;
      this.last = 0;
      this.foods = [];
      this.pausedAt = performance.now();
      this.buildObstacles();
      this.refillFood();
    }

    /**
     * Les obstacles sont tirés au hasard, mais jamais sur la ligne de départ :
     * sinon le serpent peut naître face à un mur, sans coup jouable.
     */
    buildObstacles() {
      this.obstacles = new Set();
      if (settings.obstacles === "none") return;

      const density = settings.obstacles === "many" ? 0.045 : 0.018;
      const count = Math.round(this.cols * this.rows * density);
      const cy = Math.floor(this.rows / 2);
      // Un semis en cours de partie ne doit pas tomber sur le serpent :
      // ce serait une mort instantanée sans coup jouable.
      const body = new Set((this.snake || []).map(key));

      for (let i = 0; i < count; i++) {
        const x = Math.floor(Math.random() * this.cols);
        const y = Math.floor(Math.random() * this.rows);
        if (Math.abs(y - cy) <= 1) continue; // couloir de départ
        const k = `${x},${y}`;
        if (body.has(k)) continue;
        this.obstacles.add(k);
      }
    }

    /** Cases interdites au tirage d'un jeton. */
    occupied() {
      const set = new Set(this.obstacles);
      for (const s of this.snake) set.add(key(s));
      for (const f of this.foods) set.add(key(f));
      return set;
    }

    refillFood() {
      if (!this.snake) return;
      const want = clamp(settings.foodCount, 1, 8);
      this.foods = this.foods.slice(0, want);
      let guard = want * 4;
      while (this.foods.length < want && guard-- > 0) {
        if (!this.spawnFood()) break;
      }
    }

    spawnFood() {
      const taken = this.occupied();
      const free = [];
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          const k = `${x},${y}`;
          if (!taken.has(k)) free.push({ x, y });
        }
      }
      if (!free.length) return false;

      const spot = free[Math.floor(Math.random() * free.length)];
      // Un seul jeton doré à la fois, sinon la partie devient une loterie.
      const gold =
        settings.golden &&
        !this.foods.some((f) => f.gold) &&
        Math.random() < GOLD_CHANCE;

      this.foods.push({
        x: spot.x,
        y: spot.y,
        gold,
        born: performance.now(),
        ttl: gold ? GOLD_TTL : null,
      });
      return true;
    }

    get tickMs() {
      const base = SPEEDS[settings.speed] ?? SPEEDS.normal;
      if (!settings.accelerate) return Math.max(MIN_TICK, base);
      return Math.max(MIN_TICK, base - this.score * 2.2);
    }

    // -- entrées -----------------------------------------------------

    onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const k = e.key.toLowerCase();
      // Flèches + WASD (QWERTY) + ZQSD (AZERTY). 's' et 'd' sont communs aux deux.
      const dirs = {
        arrowup: { x: 0, y: -1 }, w: { x: 0, y: -1 }, z: { x: 0, y: -1 },
        arrowdown: { x: 0, y: 1 }, s: { x: 0, y: 1 },
        arrowleft: { x: -1, y: 0 }, a: { x: -1, y: 0 }, q: { x: -1, y: 0 },
        arrowright: { x: 1, y: 0 }, d: { x: 1, y: 0 },
      };

      if (k === "escape") {
        e.preventDefault();
        e.stopPropagation();
        destroyGame();
        return;
      }

      if (k === " " || k === "enter") {
        e.preventDefault();
        e.stopPropagation();
        if (this.state === "over") this.reset();
        if (this.state === "playing") this.pause();
        else this.resume();
        return;
      }

      const d = dirs[k];
      if (!d) return;

      // On confisque la touche à la page : plus de scroll, plus de raccourci hôte.
      e.preventDefault();
      e.stopPropagation();

      if (this.state === "ready" || this.state === "paused") this.resume();
      if (this.state !== "playing") return;

      // On compare au dernier virage en file, pas à la direction courante :
      // sinon deux touches dans le même tick permettent un demi-tour mortel.
      const ref = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
      if (d.x === -ref.x && d.y === -ref.y) return;
      if (d.x === ref.x && d.y === ref.y) return;
      if (this.queue.length < 2) this.queue.push(d);
    }

    // -- boucle ------------------------------------------------------

    loop(now) {
      this.raf = requestAnimationFrame(this.loop);

      if (this.state === "playing") {
        this.expireFood(now);

        if (!this.last) this.last = now;
        this.acc += now - this.last;
        this.last = now;

        // Borne le rattrapage : un onglet revenu au premier plan ne doit pas
        // déclencher cent pas d'un coup.
        let budget = 4;
        while (this.acc >= this.tickMs && budget-- > 0) {
          this.acc -= this.tickMs;
          this.step();
          if (this.state !== "playing") break;
        }
        if (this.acc > this.tickMs * 4) this.acc = 0;
      }

      // On redessine à chaque frame : les jetons respirent même à l'arrêt.
      this.render();
    }

    expireFood(now) {
      const before = this.foods.length;
      this.foods = this.foods.filter((f) => !f.ttl || now - f.born < f.ttl);
      if (this.foods.length !== before) this.refillFood();
    }

    step() {
      if (this.queue.length) this.dir = this.queue.shift();

      const head = {
        x: this.snake[0].x + this.dir.x,
        y: this.snake[0].y + this.dir.y,
      };

      if (settings.walls) {
        if (head.x < 0 || head.y < 0 || head.x >= this.cols || head.y >= this.rows) {
          return this.gameOver();
        }
      } else {
        head.x = (head.x + this.cols) % this.cols;
        head.y = (head.y + this.rows) % this.rows;
      }

      if (this.obstacles.has(key(head))) return this.gameOver();

      // La queue libère sa case dans le même pas, sauf si on grandit encore.
      const body = this.pending > 0 ? this.snake : this.snake.slice(0, -1);
      if (!settings.ghost && body.some((s) => s.x === head.x && s.y === head.y)) {
        return this.gameOver();
      }

      this.snake.unshift(head);

      const i = this.foods.findIndex((f) => f.x === head.x && f.y === head.y);
      if (i >= 0) {
        const f = this.foods[i];
        this.score += f.gold ? 5 : 1;
        this.pending += f.gold ? settings.growth * 2 : settings.growth;
        this.foods.splice(i, 1);
        this.refillFood();
      }

      if (this.pending > 0) this.pending--;
      else this.snake.pop();
    }

    gameOver() {
      this.state = "over";
      this.pausedAt = performance.now();
      if (this.score > highScore) {
        highScore = this.score;
        chrome.storage.local.set({ highScore });
      }
    }

    // -- dessin ------------------------------------------------------

    render() {
      const ctx = this.ctx;
      const cell = this.cell;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      const ox = this.offX;
      const oy = this.offY;

      // Quadrillage et cadre : optionnels, coupés par défaut. Sans eux, aucun
      // trait ne se pose sur la page — seuls le serpent et les jetons sont dessinés.
      if (settings.grid) {
        ctx.strokeStyle = "rgba(160, 190, 170, 0.1)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= this.cols; x++) {
          ctx.moveTo(ox + x * cell + 0.5, oy);
          ctx.lineTo(ox + x * cell + 0.5, oy + this.rows * cell);
        }
        for (let y = 0; y <= this.rows; y++) {
          ctx.moveTo(ox, oy + y * cell + 0.5);
          ctx.lineTo(ox + this.cols * cell, oy + y * cell + 0.5);
        }
        ctx.stroke();

        ctx.setLineDash(settings.walls ? [] : [6, 8]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(160, 190, 170, 0.32)";
        ctx.strokeRect(ox + 1, oy + 1, this.cols * cell - 2, this.rows * cell - 2);
        ctx.setLineDash([]);
      }

      // Obstacles : neutres, pour ne pas être confondus avec un jeton.
      if (this.obstacles.size) {
        ctx.fillStyle = "rgba(90, 100, 95, 0.72)";
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = 1.5;
        for (const k of this.obstacles) {
          const [x, y] = k.split(",").map(Number);
          this.cellPath(ox + x * cell + 2, oy + y * cell + 2, cell - 4, "square");
          ctx.fill();
          ctx.stroke();
        }
      }

      this.drawFood(ox, oy, cell);
      this.drawSnake(ox, oy, cell);
      this.renderChrome();
    }

    drawFood(ox, oy, cell) {
      const ctx = this.ctx;
      const now = performance.now();

      for (const f of this.foods) {
        const pulse = 1 + 0.12 * Math.sin((now - f.born) / 260);
        const cxp = ox + f.x * cell + cell / 2;
        const cyp = oy + f.y * cell + cell / 2;
        const r = (cell / 2 - cell * 0.19) * pulse;
        const color = f.gold ? "#ffd33d" : settings.foodColor;

        ctx.beginPath();
        ctx.arc(cxp, cyp, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = f.gold ? 20 : 14;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();

        // Arc de décompte : un jeton doré s'évapore, autant le montrer.
        if (f.ttl) {
          const left = 1 - (now - f.born) / f.ttl;
          ctx.beginPath();
          ctx.arc(cxp, cyp, r + 4, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
          ctx.strokeStyle = "rgba(255, 211, 61, 0.85)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    drawSnake(ox, oy, cell) {
      const ctx = this.ctx;
      const n = this.snake.length;
      const drift = performance.now() * 0.04;

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = OUTLINE;

      for (let i = n - 1; i >= 0; i--) {
        const s = this.snake[i];
        const t = i / Math.max(1, n - 1);
        const pad = cell * (0.1 + t * 0.04);

        let fill;
        if (this.rainbow) {
          // La teinte défile le long du corps et dérive avec le temps.
          const h = (drift + i * 9) % 360;
          fill = `hsl(${h}, 72%, ${i === 0 ? 74 : 60 - t * 8}%)`;
        } else {
          const c = this.snakeHsl;
          const l = i === 0 ? c.l + 18 : c.l + 6 - t * 24;
          fill = `hsl(${c.h}, ${c.s}%, ${clamp(l, 16, 92)}%)`;
        }

        ctx.fillStyle = fill;
        if (settings.trail) {
          ctx.shadowColor = fill;
          ctx.shadowBlur = 14 * (1 - t);
        }
        this.cellPath(
          ox + s.x * cell + pad,
          oy + s.y * cell + pad,
          cell - pad * 2,
          settings.shape
        );
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.stroke();
      }

      // Œil, pour lire la direction d'un coup d'oeil.
      const head = this.snake[0];
      ctx.fillStyle = "rgba(6, 16, 10, 0.85)";
      ctx.beginPath();
      ctx.arc(
        ox + head.x * cell + cell / 2 + this.dir.x * cell * 0.16,
        oy + head.y * cell + cell / 2 + this.dir.y * cell * 0.16,
        Math.max(1.8, cell * 0.09),
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    /** Trace une case selon la forme choisie. Ne remplit pas : appelant libre. */
    cellPath(x, y, size, shape) {
      const ctx = this.ctx;
      if (shape === "circle") {
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
        return;
      }
      const r = shape === "square" ? 0 : Math.min(8, size * 0.3);
      const rr = Math.min(r, size / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + size, y, x + size, y + size, rr);
      ctx.arcTo(x + size, y + size, x, y + size, rr);
      ctx.arcTo(x, y + size, x, y, rr);
      ctx.arcTo(x, y, x + size, y, rr);
      ctx.closePath();
    }

    renderChrome() {
      // Le canvas se redessine à 60 fps, pas le HTML : on ne touche au DOM
      // que si l'état affiché a réellement changé.
      const accent = this.rainbow ? "#7ee787" : settings.snakeColor;
      const k = `${this.state}|${this.score}|${highScore}|${accent}`;
      if (k === this.chromeKey) return;
      this.chromeKey = k;

      this.hud.innerHTML =
        `SCORE <b style="color:${accent}">${this.score}</b>` +
        `<span style="opacity:.4">RECORD <b>${highScore}</b></span>`;

      if (this.state === "playing") {
        this.card.classList.add("hidden");
        return;
      }
      this.card.classList.remove("hidden");

      const keys = `<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> ou <kbd>ZQSD</kbd>`;
      const h1 = (txt) => `<h1 style="color:${accent}">${txt}</h1>`;

      if (this.state === "ready") {
        this.card.innerHTML =
          h1("Snake Anywhere") +
          `<p class="sub">${keys} pour démarrer<br>
           <kbd>Espace</kbd> pause &middot; <kbd>Échap</kbd> quitter</p>
           <p class="best">Record : ${highScore}</p>`;
      } else if (this.state === "paused") {
        this.card.innerHTML =
          h1("Pause") +
          `<p class="score">${this.score}</p>
           <p class="sub"><kbd>Espace</kbd> reprendre &middot; <kbd>Échap</kbd> quitter</p>`;
      } else {
        const best = this.score >= highScore && this.score > 0;
        this.card.innerHTML =
          h1(best ? "Nouveau record" : "Perdu") +
          `<p class="score">${this.score}</p>
           <p class="sub"><kbd>Espace</kbd> rejouer &middot; <kbd>Échap</kbd> quitter</p>
           <p class="best">Record : ${highScore}</p>`;
      }
    }
  }

  const key = (c) => `${c.x},${c.y}`;

  // ---------------------------------------------------------------- pilotage

  let game = null;

  function destroyGame() {
    if (!game) return;
    game.destroy();
    game = null;
  }

  function toggle() {
    if (game) destroyGame();
    else game = new Game();
    return !!game;
  }

  window.__snakeAnywhere = { toggle, isOpen: () => !!game };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "SNAKE_TOGGLE") sendResponse({ open: toggle() });
    else if (msg?.type === "SNAKE_PING") sendResponse({ open: !!game });
    return false;
  });
})();
