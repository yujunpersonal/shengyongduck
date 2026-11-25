/* FlightScene — canvas renderer, flight state machine and shooting model.
   World scale is real: every bird has a range D (yards); px-per-foot = view width / (2.8 × D) (≈ 53° field of view),
   so on-screen size, speed and the lead you need all match the field.
   States: flush → cruise | pass (3-D: incoming, going away, quartering) | approach → [overfly → turn →] approach → flare → swim → flush;  any flying → hit → dead */
(function () {
  const DF = window.DuckFlight;
  const R = (a, b) => a + Math.random() * (b - a);
  const RI = (a, b) => Math.floor(R(a, b + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const FTPS_PER_KMH = 3.281 / 3.6;
  const SHOT_FPS = 1150;                    // average steel shot velocity over 15–45 yd
  const G_FT = 32.2;
  const FLYING = new Set(['flush', 'cruise', 'pass', 'overfly', 'turn', 'approach', 'flare']);
  const patternR = D => .1 + D * .028;      // effective killing radius (ft), modified choke

  function hexToRgb(h) {
    h = (h || '#888888').trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const S = (c, f = 1, a = 1) => `rgba(${c.map(v => clamp(Math.round(v * f), 0, 255)).join(',')},${a})`;
  const M = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  DF.createScene = function (canvas, opts) {
    let ctx = canvas.getContext('2d');
    const A = opts.audio || null;
    const root = document.documentElement;
    const tok = n => getComputedStyle(root).getPropertyValue('--' + n);
    const C = n => hexToRgb(tok(n));

    let cfg = Object.assign({ freq: [20, 20], speed: [.8, 1.25], env: 'wetland', species: Object.keys(DF.SPECIES) }, opts.cfg);
    let W = 0, H = 0, U = 1, E, P, blades = [], tree = [], clouds = [];
    let ducks = [], ripples = [], drops = [], feathers = [], fx = [];
    let nextEvt = R(1.5, 3), paused = !!opts.paused, groupSeq = 0, last = performance.now(), clock = 0;
    let showGhost = true, lastSight = -99, spookAt = 0;
    const gun = { mounted: false, m: 0, ax: 0, ay: 0, mx: 0, my: 0, shells: 3, hist: [], recoil: 0, reload: 0, mountedAt: 0, smoke: [] };
    let shots = [], pending = [];

    const ppfAt = D => Math.min(W, H * 1.9) / (2.8 * D);
    const pan = x => clamp(x / W * 2 - 1, -1, 1);
    const loud = D => Math.pow(15 / D, 1.3);

    /* ---------- scene building ---------- */
    function build() {
      E = DF.ENVIRONMENTS[cfg.env];
      P = { top: C(E.top), low: C(E.low), water: C(E.water), veg: C(E.veg) };
      const hy = H * E.horizon;

      tree = []; let x = -10;
      while (x < W + 20) {
        if (E.conifers) { const h = R(10, E.trees) * U; tree.push([x, hy - h * .35], [x + 4 * U, hy - h], [x + 8 * U, hy - h * .35]); x += R(6, 12) * U; }
        else { tree.push([x, hy - R(3, E.trees) * U]); x += R(5, 16) * U; }
      }

      clouds = [];
      const nc = Math.round(5 * E.clouds * (W / 1200 + .4));
      for (let i = 0; i < nc; i++) {
        const w = R(120, 300) * U, puffs = [];
        for (let j = 0; j < 7; j++) puffs.push([R(-.5, .5) * w, R(-.12, .08) * w, R(.18, .32) * w]);
        clouds.push({ x: R(-.1, 1.1) * W, y: R(.06, .7) * hy, w, puffs, v: R(2, 6) * U, a: R(.18, .35) });
      }

      blades = [];
      const n = Math.round(W / 4.2 * E.reeds);
      for (let i = 0; i < n; i++) {
        const fg = Math.random() < .72;
        blades.push({ x: R(-10, W + 10), h: (fg ? R(55, 140) : R(10, 30)) * U * (E.stubble ? .32 : 1), fg,
          lean: R(-.25, .25), ph: R(0, 6.28), w: (fg ? R(1.4, 3) : R(.8, 1.4)) * Math.min(1.6, U) * (E.stubble ? .8 : 1),
          sh: R(.55, 1.15), cat: E.cattails && fg && Math.random() < .1, my: R(0, 6) * U });
      }
      blades.sort((a, b) => a.h - b.h);
      ducks = []; ripples = []; drops = []; feathers = []; fx = []; pending = []; shots = [];
      A && A.setEnv(cfg.env);
      bakeBackdrop();
      seedSwimmers();
    }

    function resize() {
      const d = dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.clientWidth; H = canvas.clientHeight; U = clamp(H / 620, .6, 1.8);
      canvas.width = Math.round(W * d); canvas.height = Math.round(H * d);
      ctx.setTransform(d, 0, 0, d, 0, 0); ctx.imageSmoothingQuality = 'high';
      gun.ax = gun.mx = W / 2; gun.ay = gun.my = H * .35;
      build();
    }

    /* ---------- ducks ---------- */
    const enabled = () => (cfg.species.length ? cfg.species : ['mallard']);
    const pickSp = () => { const e = enabled(); return e[RI(0, e.length - 1)]; };
    const base = d => d.s.kmh * FTPS_PER_KMH * d.mul * d.ppf;          // px/s
    function waterY(D) { const hy = H * E.horizon, f = clamp((D - 15) / 30, 0, 1); return hy + (H - hy) * (.55 - .47 * f); }
    function flockSize(s) {
      const cap = Math.max(2, Math.ceil(cfg.freq[1] * 1.5));
      return Math.max(1, Math.min(cap, RI(s.flock[0], s.flock[1])));
    }

    function mkDuck(k, o) {
      const s = DF.SPECIES[k], hen = Math.random() < .4, col = {};
      const pick = { head: hen ? 'plumage-hen' : s.head, body: hen ? 'plumage-hen' : s.body, breast: hen ? 'plumage-hen-breast' : s.breast,
        wing: s.wing, spec: s.spec, bill: hen ? 'plumage-bill-hen' : s.billc, feet: 'plumage-feet-orange', dark: 'plumage-dark' };
      const sil = E.silhouette || 0, darkC = C('plumage-dark');
      for (const p in pick) { const f = R(.92, 1.08); col[p] = M(C(pick[p]).map(v => v * f), darkC, sil); }
      col.white = M([240, 238, 230], darkC, sil * .7);
      const D = (o && o.D) || R(15, 45);
      const d = Object.assign({ k, s, hen, col, size: s.size * R(.93, 1.07), mul: R(cfg.speed[0], cfg.speed[1]),
        ph: R(0, 6.28), a: 0, state: 'cruise', t: 0, x: 0, y: 0, vx: 0, vy: 0, glide: 0, delay: 0, wob: R(0, 6.28),
        ret: 0, tvy: 0, dir: 1, fl: null, grp: 0 }, o, { D });
      d.ppf = ppfAt(D); d.z = 15 / D;
      return d;
    }

    function report(d, verb, n, yd) {
      lastSight = clock;
      opts.onEvent && opts.onEvent({ name: d.s.name, sex: d.hen ? 'hen' : 'drake', count: n, verb, kmh: Math.round(d.s.kmh * d.mul), yd: Math.round(yd || d.D) });
    }
    function sayCall(d, kind, delay) { A && A.call(d.k, d.hen ? 'hen' : 'drake', pan(d.x), loud(d.D), kind, delay); }

    function splash(d, big) {
      const k = d.ppf;
      for (let i = 0; i < 3; i++) ripples.push({ x: d.x, y: d.y, r: (.5 + i * 1.2) * k, k, life: 1 + i * .25 });
      const n = big ? 22 : 12;
      for (let i = 0; i < n; i++) drops.push({ x: d.x + R(-2, 2) * k, y: d.y, vx: R(-6, 6) * k, vy: R(-16, -5) * k, g: G_FT * k, life: R(.4, .9) });
    }

    function startFlush(d, dir, i) {
      const fromWater = d.state === 'swim';
      if (fromWater) splash(d, true);
      d.state = 'flush'; d.t = 0; d.dir = dir;
      const b = base(d); d.vx = dir * b * .12; d.vy = -b * .33;
      if (A && (i || 0) < 4) A.flush(pan(d.x), loud(d.D) * .8, d.s.hz, fromWater, d.delay);
    }

    function seedSwimmers() {
      if (Math.random() < .3) return;
      const k = pickSp(), grp = ++groupSeq, n = RI(1, 3);
      for (let i = 0; i < n; i++) {
        const d = mkDuck(k, { D: R(20, 40), dir: Math.random() < .5 ? 1 : -1, grp });
        d.state = 'swim'; d.x = W * R(.25, .75); d.ty = d.y = waterY(d.D); ducks.push(d);
      }
    }

    function evFlush(atX) {
      const sit = ducks.filter(d => d.state === 'swim');
      if (atX == null && sit.length && Math.random() < .55) {
        const dir = Math.random() < .5 ? 1 : -1, grp = sit.filter(d => d.grp === sit[0].grp);
        grp.forEach((d, i) => { d.delay = i * R(.05, .2); startFlush(d, dir, i); });
        report(grp[0], 'flushed off the water', grp.length);
        if (Math.random() < .7) sayCall(grp[0], 'flush', .15);
        return grp.length;
      }
      const k = pickSp(), s = DF.SPECIES[k], n = flockSize(s), dir = Math.random() < .5 ? 1 : -1;
      const x0 = atX != null ? atX : R(.15, .85) * W, D0 = R(15, 26), fl = { tvy: 0, ret: 0 };
      let first;
      for (let i = 0; i < n; i++) {
        const d = mkDuck(k, { D: D0 + R(0, 4), fl: s.shared ? fl : null });
        d.x = x0 + R(-10, 10) * d.ppf; d.y = H - R(8, 30) * U; d.delay = i * R(.08, .3);
        startFlush(d, dir, i); ducks.push(d); first = first || d;
      }
      report(first, 'flushed from the reeds', n);
      if (Math.random() < .7) sayCall(first, 'flush', .2);
      return n;
    }

    function evFly(land) {
      const k = pickSp(), s = DF.SPECIES[k], n = flockSize(s), dir = Math.random() < .5 ? 1 : -1;
      const D0 = land ? R(20, 38) : R(22, 45), y0 = H * E.horizon * R(.1, .5), lx = W * R(.3, .7), fl = { tvy: 0, ret: 0 }, grp = ++groupSeq;
      const circle = land && s.circles && Math.random() < .5;
      let first;
      for (let i = 0; i < n; i++) {
        const d = mkDuck(k, { D: clamp(D0 + R(-3, 3), 15, 48), dir, grp, fl: s.shared ? fl : null });
        const gap = i * R(6, 15) * d.ppf;
        d.x = dir > 0 ? -40 * U - gap : W + 40 * U + gap;
        d.y = y0 + R(-6, 6) * d.ppf; d.vx = dir * base(d);
        if (land) {
          d.tx = lx + R(-15, 15) * d.ppf; d.ty = waterY(d.D);
          if (circle) { d.state = 'overfly'; d.ox = d.tx + dir * R(60, 100) * d.ppf; d.oy = d.y + R(3, 10) * d.ppf; }
          else d.state = 'approach';
        }
        ducks.push(d); first = first || d;
      }
      report(first, land ? (circle ? 'circling to land' : 'dropping in') : 'crossing', n);
      if (Math.random() < (land ? .6 : .25)) sayCall(first, land ? 'hail' : 'chatter', .3);
      return n;
    }

    /* 3-D passes: birds keep a world position (feet: X lateral, H above eye level, Z out from the gun) and are
       projected every step, so they grow, shrink and change aspect as they come in, go away or quarter. */
    const halfFt = D => W / 2 / ppfAt(D);
    function project(d, dt) {
      const Dy = d.wZ / 3; d.hidden = Dy < 5;
      d.D = Math.max(5, Dy); d.ppf = ppfAt(d.D); d.z = 15 / d.D;
      const nx = W / 2 + d.wX * d.ppf, ny = H * E.horizon - d.wH * d.ppf;
      if (dt) { d.vx = (nx - d.x) / dt; d.vy = (ny - d.y) / dt; }
      d.x = nx; d.y = ny;
    }
    const PASS_KINDS = [                              // [kind, weight, verb]
      ['ltr', 15, 'crossing left to right'], ['rtl', 15, 'crossing right to left'],
      ['in', 18, 'incoming'], ['away', 16, 'going away'], ['qin', 18, 'quartering in'], ['qaway', 18, 'quartering away']];
    function evPass(force) {
      let r = Math.random() * PASS_KINDS.reduce((a, k) => a + k[1], 0), pk = PASS_KINDS[0];
      for (const k of PASS_KINDS) { if ((r -= k[1]) < 0) { pk = k; break; } }
      if (force) pk = PASS_KINDS.find(k => k[0] === force) || pk;
      const kind = pk[0], cross = kind === 'ltr' || kind === 'rtl', into = kind === 'in' || kind === 'qin', quarter = kind[0] === 'q';
      const k = pickSp(), s = DF.SPECIES[k], n = flockSize(s), grp = ++groupSeq, fl = s.shared ? {} : null;
      const side = Math.random() < .5 ? 1 : -1;
      let hd;
      if (cross) hd = (kind === 'ltr' ? 1 : -1) * (Math.PI / 2 + R(-.25, .25));          // ±15° off square
      else { const yaw = (quarter ? R(30, 65) : R(0, 22)) * Math.PI / 180 * side; hd = into ? Math.PI - yaw : yaw; }
      const ux = Math.sin(hd), uz = Math.cos(hd);
      const band = Math.random();                                 // close, mid or long pass
      const D0 = band < .3 ? R(14, 24) : band < .75 ? R(24, 38) : R(38, 58);
      const Z0 = D0 * 3, hw = halfFt(D0), X0 = cross ? R(-.3, .3) * hw : R(-.45, .45) * hw;
      const H0 = Math.min(Math.random() < .2 ? R(5, 10) : R(10, 20 + D0 * .5), .8 * H * E.horizon / ppfAt(D0));   // some skim low; all pass through the view
      let L;
      if (cross) L = hw * 1.15 + Math.abs(X0) + 12;
      else if (into) L = Math.min((Math.max(225, Z0 + 60) - Z0) / -uz, 220);
      else L = Math.min((Z0 - R(0, 9)) / uz, 220);
      const mul = R(cfg.speed[0], cfg.speed[1]), v = s.kmh * FTPS_PER_KMH * mul, wvh = R(-1.5, 1.5);
      let first;
      for (let i = 0; i < n; i++) {
        const back = L + i * R(5, 12), p = R(-8, 8), d = mkDuck(k, { grp, fl, mul: mul * R(.97, 1.03) });
        Object.assign(d, { state: 'pass', hd, yo: 0, climb: 0, wvh, into, dir: ux >= 0 ? 1 : -1, los: into ? -1 : 1 });
        d.wX = X0 - ux * back + uz * p; d.wZ = Z0 - uz * back - ux * p;
        d.wH = Math.max(4, H0 - wvh * back / v + R(-3, 3));
        project(d, 0); ducks.push(d); first = first || d;
      }
      report(first, pk[2], n, D0);
      if (Math.random() < .3) sayCall(first, 'chatter', .3);
      return n;
    }

    function scheduleNext(n) { nextEvt = n * 60 / R(cfg.freq[0], cfg.freq[1]); }
    function fireEvent() {
      const m = E.mix, r = Math.random() * (m[0] + m[1] + m[2]);
      scheduleNext(r < m[0] ? evFlush() : r < m[0] + m[1] ? evPass() : evFly(true));
    }

    /* ---------- shooting ---------- */
    function muzzleVel(t0, t1) {
      const h = gun.hist; if (h.length < 2) return [0, 0];
      const at = t => { let best = h[0]; for (const e of h) if (Math.abs(e[0] - t) < Math.abs(best[0] - t)) best = e; return best; };
      const a = at(t0), b = at(t1), dt = b[0] - a[0];
      return dt > .01 ? [(b[1] - a[1]) / dt, (b[2] - a[2]) / dt] : [0, 0];
    }

    function fire() {
      if (paused || !gun.mounted) return;
      if (gun.shells <= 0) { A && A.click('empty'); return; }
      gun.shells--; gun.recoil = 1; A && A.shot();
      const early = gun.m < .85;
      let ax = gun.mx, ay = gun.my;
      if (early) { ax += R(-1, 1) * 40 * U; ay += R(-1, 1) * 40 * U; }
      const shot = { ax, ay, t: clock, mv: muzzleVel(clock - .09, clock), early, kills: [],
        sinceMount: clock - gun.mountedAt, sinceSight: clock - lastSight, low: ay > H * E.horizon - 6 * U, best: null };
      for (const d of ducks) {
        if (d.delay > 0 || d.hidden || !(FLYING.has(d.state) || d.state === 'swim')) continue;
        const tof = d.D * 3 / SHOT_FPS, px = d.x + d.vx * tof, py = d.y + d.vy * tof;
        const e = Math.hypot(ax - px, ay - py) / d.ppf;
        pending.push({ d, at: clock + tof, ax, ay, shot });
        if (!shot.best || e < shot.best.e) shot.best = { d, e, tof, px, py, vx: d.vx, vy: d.vy, onWater: d.state === 'swim' };
      }
      shots.push(shot);
      const b = shot.best;
      fx.push({ x: ax, y: ay, r: b ? patternR(b.d.D) * b.d.ppf : 24 * U, life: 1.4, ghost: b ? { x: b.px, y: b.py, r: .6 * b.d.ppf } : null });
      gun.smoke.push({ x: gun.mx, y: gun.my, r: 6 * U, life: 1 });
      gun.my -= 26 * U;                   // muzzle jump
      spookAt = clock + .25;
      emitGun();
    }

    function kill(d) {
      d.state = 'hit'; d.dead = true; d.spin = 0; d.spinV = R(-6, 6); d.t = 0;
      d.vx *= .7; d.vy = Math.min(d.vy, 0) * .3;
      d.ty = Math.max(d.y + 4, waterY(d.D));
      for (let i = 0; i < 14; i++) feathers.push({ x: d.x, y: d.y, vx: d.vx * .3 + R(-3, 3) * d.ppf, vy: R(-4, 1) * d.ppf, r: R(.6, 1.4) * d.ppf * .12 + 1, rot: R(0, 6.28), vr: R(-4, 4), life: R(1.5, 3), c: Math.random() < .5 ? d.col.breast : d.col.body, g: d.ppf });
    }

    function spook() {
      for (const d of ducks) {
        if (d.dead || d.delay > 0) continue;
        if (d.state === 'pass') {                          // flare away: climb hard, speed up, veer
          d.mul = Math.min(d.mul * 1.2, 2.2); d.climb = d.s.kmh * FTPS_PER_KMH * d.mul * .3; d.hd += R(-.5, .5); d.fl = null; d.glide = 0;
          continue;
        }
        if (['cruise', 'approach', 'overfly', 'turn', 'flare'].includes(d.state)) {
          const b = base(d);
          if (Math.abs(d.vx) > 1) d.dir = Math.sign(d.vx);
          d.state = 'cruise'; d.mul = Math.min(d.mul * 1.2, 2.2); d.tvy = -b * .5; d.ret = R(.8, 1.5); d.fl = null; d.glide = 0; d.cup = false;
        }
      }
      const sw = ducks.filter(d => d.state === 'swim' && !d.dead);
      sw.forEach((d, i) => { d.delay = i * R(.05, .25); startFlush(d, Math.random() < .5 ? 1 : -1, i); });
      const alive = ducks.find(d => !d.dead && FLYING.has(d.state));
      if (alive) sayCall(alive, 'alarm', .1);
      nextEvt = Math.max(nextEvt, 4);
    }

    function finalize(s) {
      const r = { hit: s.kills.length > 0, kills: s.kills.map(d => ({ name: d.s.name, sex: d.hen ? 'hen' : 'drake', yd: Math.round(d.D) })),
        notes: [], flags: [], sinceMount: s.sinceMount, sinceSight: s.sinceSight < 15 ? s.sinceSight : null, target: null };
      const b = s.best;
      if (b) {
        const d = b.d, sp = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / sp, uy = b.vy / sp;
        const ex = (s.ax - b.px) / d.ppf, ey = (s.ay - b.py) / d.ppf;
        const along = ex * ux + ey * uy, vert = ey - along * uy;
        r.target = { name: d.s.name, sex: d.hen ? 'hen' : 'drake', yd: Math.round(d.D), kmh: Math.round(sp / d.ppf / FTPS_PER_KMH),
          leadNeeded: sp / d.ppf * b.tof, along, vert, miss: b.e };
        if (sp / d.ppf > 6) {
          const post = muzzleVel(s.t + .1, s.t + .28);
          const pre = (s.mv[0] * ux + s.mv[1] * uy) / sp, aft = (post[0] * ux + post[1] * uy) / sp;
          if (pre < .4) r.notes.push('swing stopped at the shot');
          else if (aft < .35) r.notes.push('no follow-through');
          else r.notes.push('smooth swing');
        }
        if (b.onWater) r.flags.push('bird on the water');
        if (d.D > 40) r.flags.push('long shot, past 40 yd');
      }
      if (s.early) r.flags.push('fired before the gun was mounted');
      if (s.low) r.flags.push('low shot, unsafe');
      opts.onShot && opts.onShot(r);
    }

    function emitGun() { opts.onGun && opts.onGun({ mounted: gun.mounted, shells: gun.shells }); }

    /* ---------- simulation ---------- */
    function update(dt, t) {
      clock += dt;
      nextEvt -= dt;
      if (nextEvt <= 0) { if (ducks.length < 120) fireEvent(); else nextEvt = 2; }
      const hy = H * E.horizon;

      for (const d of ducks) {
        if (d.delay > 0) { d.delay -= dt; continue; }
        d.t += dt;
        const b = base(d), s = d.s; let hzm = 1; d.cup = false; d.feet = false;

        switch (d.state) {
          case 'flush': {                                   // jump-start: steep climb, accelerating
            hzm = 1.35;
            const k = Math.min(1, d.t / 2.2), ang = (70 - 55 * k) * Math.PI / 180, sp = b * (.35 + .65 * k), e = Math.min(1, dt * 4);
            d.vx += (d.dir * sp * Math.cos(ang) - d.vx) * e;
            d.vy += (-sp * Math.sin(ang) - d.vy) * e;
            if (d.t > 2.2) { d.state = 'cruise'; d.tvy = -b * .15; d.ret = 1; }
            break;
          }
          case 'cruise': {
            d.vx += (d.dir * b - d.vx) * Math.min(1, dt * 1.5);
            const tg = d.fl || d; tg.ret -= dt;
            if (tg.ret <= 0) {
              tg.ret = R(.4, 1.6) * (d.fl ? .6 : 1);
              tg.tvy = R(-.5, .5) * b * (.08 + s.erratic * .35) - (d.y > hy - 70 * U ? b * .25 : 0) + (d.y < 40 * U ? b * .2 : 0);
            }
            d.vy += (tg.tvy - d.vy) * Math.min(1, dt * (d.fl ? 3 : 2));
            if (Math.random() < .04 * dt) sayCall(d, 'chatter');
            break;
          }
          case 'pass': {
            const v = s.kmh * FTPS_PER_KMH * d.mul, tg = d.fl || d;
            tg.pret = (tg.pret || 0) - dt;
            if (tg.pret <= 0) { tg.pret = R(.5, 1.8); tg.tvh = R(-1, 1) * v * (.02 + s.erratic * .12); tg.tyaw = R(-1, 1) * s.erratic * .2; }
            const e = Math.min(1, dt * 1.5);
            d.wvh += ((tg.tvh || 0) + d.climb - d.wvh) * e;
            d.yo += ((tg.tyaw || 0) - d.yo) * e;
            const h = d.hd + d.yo, vX = Math.sin(h) * v, vZ = Math.cos(h) * v;
            d.wX += vX * dt; d.wZ += vZ * dt; d.wH = Math.max(4, d.wH + d.wvh * dt);
            project(d, dt);
            const ll = Math.hypot(d.wX, d.wH, d.wZ) || 1;
            d.los = (vX * d.wX + d.wvh * d.wH + vZ * d.wZ) / (ll * Math.hypot(v, d.wvh));   // +1 straight away, -1 straight at you
            const on = d.x > -80 * U && d.x < W + 80 * U && d.y > -80 * U && d.y < hy;
            if (on && !d.hidden) d.seen = true;
            if ((d.seen && !on) || d.wZ > 270 || (d.wZ < 15 && vZ < 0) || d.t > 30 || (!d.seen && d.t > 15)) d.gone = true;
            if (Math.random() < .04 * dt) sayCall(d, 'chatter');
            break;
          }
          case 'overfly': {
            const dx = d.ox - d.x, dy = d.oy - d.y, dist = Math.hypot(dx, dy) || 1, e = Math.min(1, dt * 1.5);
            d.vx += (dx / dist * b - d.vx) * e; d.vy += (dy / dist * b * .6 - d.vy) * e;
            if (d.dir * (d.x - d.ox) > 0 || dist < 10 * d.ppf) { d.state = 'turn'; d.t = 0; if (Math.random() < .4) sayCall(d, 'hail'); }
            break;
          }
          case 'turn': {
            d.vx += (-d.dir * b * .8 - d.vx) * Math.min(1, dt * 1.4);
            d.vy += (b * .05 - d.vy) * Math.min(1, dt * 2);
            if (Math.sign(d.vx) === -d.dir && Math.abs(d.vx) > b * .5) { d.dir = -d.dir; d.state = 'approach'; }
            break;
          }
          case 'approach': {
            const dx = d.tx - d.x, dy = d.ty - d.y, dist = Math.hypot(dx, dy) || 1, ft = dist / d.ppf;
            const sp = b * (.35 + .65 * Math.min(1, ft / 120)), e = Math.min(1, dt * 2);
            d.vx += (dx / dist * sp - d.vx) * e; d.vy += (dy / dist * sp - d.vy) * e;
            d.cup = ft < 60; d.feet = ft < 25;
            if (ft < 5) { d.state = 'flare'; d.t = 0; }
            break;
          }
          case 'flare': {
            d.feet = true;
            d.vx *= 1 - Math.min(1, dt * 3.5);
            d.vy += (.1 * b - d.vy) * Math.min(1, dt * 4);
            if (d.t > .45) {
              d.state = 'swim'; d.y = d.ty; d.vx = d.vy = 0; d.t = 0; d.dir = Math.random() < .5 ? 1 : -1;
              splash(d, false); A && A.splash(pan(d.x), loud(d.D) * .5);
            }
            break;
          }
          case 'hit': {
            d.vy += G_FT * d.ppf * dt; d.vx *= 1 - Math.min(1, dt * .8);
            d.spin += d.spinV * dt; d.a = .2 + .3 * Math.sin(d.t * 7);
            d.x += d.vx * dt; d.y += d.vy * dt;
            if (d.y >= d.ty) { d.y = d.ty; d.state = 'dead'; d.t = 0; splash(d, true); A && A.splash(pan(d.x), loud(d.D)); }
            continue;
          }
          case 'dead': d.y = d.ty + Math.sin(t * 1.3 + d.wob) * .4 * U; continue;
        }

        if (d.state === 'swim') {
          d.x += d.dir * 1 * d.ppf * dt; d.y = d.ty + Math.sin(t * 1.5 + d.wob) * .6 * U;
          if (Math.random() < .008 * dt) sayCall(d, 'chatter');
          continue;
        }

        if (d.state === 'flare') { d.ph += dt * s.hz * 6.28 * 1.2; d.a = Math.sin(d.ph); }
        else if (d.cup) { d.ph += dt * s.hz * 6.28 * .45; d.a = .72 + Math.sin(d.ph) * .18; }
        else if (d.glide > 0) { d.glide -= dt; d.a += (.3 - d.a) * Math.min(1, dt * 10); }
        else {
          d.ph += dt * s.hz * hzm * 6.28;
          d.a = Math.sin(d.ph + .25 * Math.sin(d.ph));
          if ((d.state === 'cruise' || d.state === 'pass') && Math.random() < s.glide * dt * .5) d.glide = R(.4, .9);
        }
        if (d.state !== 'pass') { d.x += d.vx * dt; d.y += d.vy * dt; }
      }

      // shot pellets arriving
      for (const p of pending) {
        if (clock < p.at) continue;
        p.done = true;
        const d = p.d;
        if (d.dead || d.hidden || !(FLYING.has(d.state) || d.state === 'swim')) continue;
        const e = Math.hypot(d.x - p.ax, d.y - p.ay) / d.ppf, r = patternR(d.D) + .3 * d.size;
        if (e <= (d.D > 40 ? r * .7 : r)) { kill(d); p.shot.kills.push(d); }
      }
      pending = pending.filter(p => !p.done);
      for (const s of shots) if (!s.done && clock >= s.t + .3) { s.done = true; finalize(s); }
      shots = shots.filter(s => !s.done);
      if (spookAt && clock >= spookAt) { spookAt = 0; spook(); }

      ducks = ducks.filter(d => !d.gone && (d.state === 'dead' ? d.t < 10 : true) && (d.state === 'swim' || d.state === 'dead' || d.state === 'hit' || d.delay > 0
        || ['pass', 'approach', 'overfly', 'turn', 'flare'].includes(d.state) || (d.x > -160 * U && d.x < W + 160 * U && d.y > -140 * U)));
      if (ducks.filter(d => d.state === 'swim').length > 7) evFlush();

      for (const r of ripples) { r.r += dt * 3 * r.k; r.life -= dt * .45; }
      ripples = ripples.filter(r => r.life > 0);
      for (const p of drops) { p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
      drops = drops.filter(p => p.life > 0);
      for (const f of feathers) { f.vy += f.g * 2 * dt; f.vx *= 1 - dt * 2; f.vy *= 1 - dt * 2.5; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vr * dt; f.life -= dt; }
      feathers = feathers.filter(f => f.life > 0);
      for (const f of fx) f.life -= dt;
      fx = fx.filter(f => f.life > 0);
      for (const c of clouds) { c.x += c.v * dt; if (c.x - c.w > W) c.x = -c.w; }

      // gun
      gun.m = clamp(gun.m + (gun.mounted ? 1 : -1) * dt / .25, 0, 1);
      const k = Math.min(1, dt * 22);
      gun.mx += (gun.ax - gun.mx) * k; gun.my += (gun.ay - gun.my) * k;
      gun.hist.push([clock, gun.mx, gun.my]); while (gun.hist.length && gun.hist[0][0] < clock - .6) gun.hist.shift();
      gun.recoil = Math.max(0, gun.recoil - dt * 6);
      for (const s of gun.smoke) { s.life -= dt; s.r += 14 * U * dt; s.x += 6 * U * dt; s.y -= 4 * U * dt; }
      gun.smoke = gun.smoke.filter(s => s.life > 0);
      if (!gun.mounted && gun.shells < 3) {
        gun.reload += dt;
        if (gun.reload > .55) { gun.reload = 0; gun.shells++; A && A.click('load'); emitGun(); }
      }

      A && A.updateWings(ducks.filter(d => d.delay <= 0 && !d.hidden && FLYING.has(d.state)), W);
    }

    /* ---------- drawing ---------- */
    let bg = null, dpr = 1, dtS = 1 / 60;
    function layer(w, h) { const c = document.createElement('canvas'); c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr); const x = c.getContext('2d'); x.scale(dpr, dpr); return [c, x]; }
    function bakeBackdrop() {                       // sky, tree line and still water never change: paint once
      if (!document.createElement) { bg = null; return; }
      const [c, x] = layer(W, H), keep = ctx;
      ctx = x; drawSky(true); drawWater(0, true); ctx = keep; bg = c;
      for (const cl of clouds) {                    // each cloud becomes a sprite
        const pad = cl.w * .95, [cc, cx] = layer(pad * 2, pad * .7), col = E.sun ? M(P.low, P.top, .35) : M([250, 250, 248], P.low, .25);
        for (const p of cl.puffs) {
          const px = pad + p[0], py = pad * .35 + p[1], rr = p[2];
          const rg = cx.createRadialGradient(px, py, 0, px, py, rr);
          rg.addColorStop(0, S(col, 1, cl.a)); rg.addColorStop(1, S(col, 1, 0));
          cx.fillStyle = rg; cx.beginPath(); cx.ellipse(px, py, rr, rr * .45, 0, 0, 6.28); cx.fill();
        }
        cl.img = cc; cl.pad = pad;
      }
    }
    function drawClouds() {
      for (const c of clouds) if (c.img) ctx.drawImage(c.img, c.x - c.pad, c.y - c.pad * .35, c.pad * 2, c.pad * .7);
    }
    function drawSky(baking) {
      const hy = H * E.horizon;
      let g = ctx.createLinearGradient(0, 0, 0, hy);
      g.addColorStop(0, S(P.top)); g.addColorStop(1, S(P.low));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, hy + 1);
      if (E.sun) {
        const r = ctx.createRadialGradient(W * .7, hy, 0, W * .7, hy, W * .45);
        r.addColorStop(0, S(P.low, 1.15, .6)); r.addColorStop(1, S(P.low, 1, 0));
        ctx.fillStyle = r; ctx.fillRect(0, 0, W, hy);
      }
      const cc = E.sun ? M(P.low, P.top, .35) : M([250, 250, 248], P.low, .25);
      if (!baking) for (const c of clouds) for (const p of c.puffs) {
        const x = c.x + p[0], y = c.y + p[1], rr = p[2];
        const rg = ctx.createRadialGradient(x, y, 0, x, y, rr);
        rg.addColorStop(0, S(cc, 1, c.a)); rg.addColorStop(1, S(cc, 1, 0));
        ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(x, y, rr, rr * .45, 0, 0, 6.28); ctx.fill();
      }
      const hz = ctx.createLinearGradient(0, hy - 60 * U, 0, hy);
      hz.addColorStop(0, S(P.low, 1, 0)); hz.addColorStop(1, S(P.low, 1.03, .5));
      ctx.fillStyle = hz; ctx.fillRect(0, hy - 60 * U, W, 60 * U);
      ctx.fillStyle = S(M(P.veg, P.low, .45), .82);
      ctx.beginPath(); ctx.moveTo(0, hy + 1); tree.forEach(p => ctx.lineTo(p[0], p[1])); ctx.lineTo(W, hy + 1); ctx.closePath(); ctx.fill();
    }

    function drawWater(t, baking) {
      const hy = H * E.horizon;
      const g = ctx.createLinearGradient(0, hy, 0, H);
      g.addColorStop(0, S(M(P.water, P.low, .45))); g.addColorStop(.35, S(P.water)); g.addColorStop(1, S(M(P.water, P.veg, .35), .85));
      ctx.fillStyle = g; ctx.fillRect(0, hy, W, H - hy);
      ctx.fillStyle = S(M(P.veg, P.water, .55), .9, .35);
      ctx.beginPath(); ctx.moveTo(0, hy); tree.forEach(p => ctx.lineTo(p[0], hy + (hy - p[1]) * .7)); ctx.lineTo(W, hy); ctx.closePath(); ctx.fill();
      if (baking) return;
      drawRipplesLines(t);
    }
    function drawRipplesLines(t) {
      const hy = H * E.horizon;
      ctx.lineWidth = 1;
      const n = Math.round(W / 22);
      for (let i = 0; i < n; i++) {
        const yy = hy + 3 + ((i * 37) % Math.max(1, H - hy)), dep = (yy - hy) / (H - hy);
        const xx = ((i * 173 + t * (5 + 12 * dep) * U) % (W + 120)) - 60, len = (8 + dep * 40) * U;
        ctx.strokeStyle = S(P.low, 1.1, .1 + .08 * Math.sin(t * .8 + i));
        ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + len, yy); ctx.stroke();
      }
    }

    function drawBlades(t, fg) {
      const hy = H * E.horizon;
      ctx.lineCap = 'round';
      for (const b of blades) {
        if (b.fg !== fg) continue;
        const baseY = fg ? H + 4 : hy + 2 + b.my;
        const sway = (paused || opts.reducedMotion ? 0 : Math.sin(t * 1.25 + b.ph + b.x * .004) * (fg ? 3.5 : 1.2) * U) + b.lean * b.h;
        const tx = b.x + sway, ty = baseY - b.h;
        ctx.strokeStyle = S(fg ? P.veg : M(P.veg, P.low, .3), b.sh * (fg ? .8 : 1));
        ctx.lineWidth = b.w;
        ctx.beginPath(); ctx.moveTo(b.x, baseY); ctx.quadraticCurveTo(b.x + sway * .25, baseY - b.h * .6, tx, ty); ctx.stroke();
        if (b.cat) { ctx.fillStyle = S(P.veg, .42); ctx.beginPath(); ctx.ellipse(tx - sway * .04, ty + 9 * U, b.w * 1.5, 7 * U, b.lean, 0, 6.28); ctx.fill(); }
      }
    }

    function wing(d, far) {
      const c = d.col, a = d.a, ty = -30 * a - 2, tx = -13 - 5 * (1 - Math.abs(a)), f = far ? .7 : 1;
      ctx.save(); if (far) ctx.translate(2.5, -1.4);
      const E1 = [1, -2 + ty * .55], TR = [-7, -2 + ty * .5], RB = [-11, -2];
      ctx.fillStyle = S(c.wing, f);
      ctx.beginPath(); ctx.moveTo(6, -2);
      ctx.quadraticCurveTo(5, -2 + ty * .3, E1[0], E1[1]);
      ctx.quadraticCurveTo(tx + 6, ty * .95, tx, ty);
      ctx.quadraticCurveTo(tx - 2, ty * .8, TR[0], TR[1]);
      ctx.quadraticCurveTo(-10, -2 + ty * .2, RB[0], RB[1]);
      ctx.closePath(); ctx.fill();
      if (d.s.forewing && !d.hen && Math.abs(a) > .15) {
        ctx.fillStyle = S(c.white, f); ctx.beginPath(); ctx.moveTo(5, -2); ctx.quadraticCurveTo(4, -2 + ty * .25, 2, -2 + ty * .45);
        ctx.lineTo(-2, -2 + ty * .4); ctx.lineTo(-1, -2); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = S(c.dark, f, .55);
      ctx.beginPath(); ctx.moveTo(E1[0], E1[1]); ctx.quadraticCurveTo(tx + 6, ty * .95, tx, ty); ctx.quadraticCurveTo(tx - 2, ty * .8, TR[0], TR[1]); ctx.closePath(); ctx.fill();
      if (Math.abs(a) > .15) {
        const p1 = [RB[0] + (TR[0] - RB[0]) * .15, RB[1] + (TR[1] - RB[1]) * .15], p2 = [RB[0] + (TR[0] - RB[0]) * .6, RB[1] + (TR[1] - RB[1]) * .6];
        ctx.fillStyle = S(c.spec, f);
        ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p2[0] + 3.5, p2[1]); ctx.lineTo(p1[0] + 3.5, p1[1]); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }

    function head(d, hx, hy) {
      const c = d.col, s = d.s, bl = 6.5 * s.bill, bw = s.bill > 1.3 ? 3.8 : 2.3;
      ctx.fillStyle = S(c.head); ctx.beginPath(); ctx.ellipse(hx, hy, 5.2, 4.4, 0, 0, 6.28); ctx.fill();
      if (!d.hen && d.k === 'wigeon') { ctx.fillStyle = S(c.white); ctx.beginPath(); ctx.ellipse(hx + .5, hy - 3.4, 3, 1.1, 0, 0, 6.28); ctx.fill(); }
      if (!d.hen && d.k === 'pintail') { ctx.strokeStyle = S(c.white); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx - 2, hy + 1); ctx.lineTo(hx - 6, hy + 6); ctx.stroke(); }
      ctx.fillStyle = S(c.bill);
      ctx.beginPath(); ctx.moveTo(hx + 3.8, hy - 1);
      ctx.quadraticCurveTo(hx + 3.8 + bl * .6, hy - 1, hx + 3.8 + bl, hy - .4 - (bw - 2.3) * .4);
      ctx.lineTo(hx + 3.8 + bl, hy + bw * .7);
      ctx.quadraticCurveTo(hx + 3.8 + bl * .5, hy + 2, hx + 3.8, hy + 1.8);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = S(c.dark); ctx.beginPath(); ctx.arc(hx + 1.6, hy - 1.1, .8, 0, 6.28); ctx.fill();
    }

    function body(d) {
      const c = d.col, s = d.s, nx = 6 * (s.neck - 1), tl = 8 + 10 * (s.tail - 1);
      ctx.fillStyle = S(c.dark); ctx.beginPath(); ctx.moveTo(-17, -2.6); ctx.lineTo(-18 - tl, -.6); ctx.lineTo(-17, 2.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = S(c.body); ctx.beginPath(); ctx.ellipse(0, 0, 20, 6.5, 0, 0, 6.28); ctx.fill();
      ctx.fillStyle = S(c.breast); ctx.beginPath(); ctx.ellipse(11, 1, 9, 5.3, 0, 0, 6.28); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.13)'; ctx.beginPath(); ctx.ellipse(-2, 3.6, 17, 2.6, 0, 0, 6.28); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.ellipse(0, -3.4, 15, 2, 0, 0, 6.28); ctx.fill();
      ctx.strokeStyle = S(c.head); ctx.lineWidth = 5.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(15, -1); ctx.lineTo(23 + nx, -3); ctx.stroke();
      if (!d.hen && d.k === 'mallard') { ctx.strokeStyle = S(c.white, 1, .9); ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(18.6, -4.2); ctx.lineTo(19.3, 1.7); ctx.stroke(); }
      head(d, 26 + nx, -3.6);
      if (d.feet) { ctx.strokeStyle = S(c.feet); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-3, 5); ctx.lineTo(-7, 12); ctx.moveTo(0, 5); ctx.lineTo(-4, 12); ctx.stroke(); }
    }

    function sitting(d) {
      const c = d.col, s = d.s;
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(0, 4, 20, 2.6, 0, 0, 6.28); ctx.fill();
      ctx.fillStyle = S(c.dark); ctx.beginPath(); ctx.moveTo(-15, -3); ctx.lineTo(-21 - 6 * (s.tail - 1), -6); ctx.lineTo(-17, 1); ctx.closePath(); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.rect(-30, -30, 70, 31); ctx.clip();
      ctx.fillStyle = S(c.body); ctx.beginPath(); ctx.ellipse(0, -1, 18, 6.5, 0, 0, 6.28); ctx.fill();
      ctx.fillStyle = S(c.breast); ctx.beginPath(); ctx.ellipse(10, -1, 8, 6, 0, 0, 6.28); ctx.fill();
      ctx.fillStyle = S(c.wing, .9); ctx.beginPath(); ctx.ellipse(-3, -4, 12, 3, -.05, 0, 6.28); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = S(c.head); ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(12, -5); ctx.lineTo(14, -11 - 4 * (s.neck - 1)); ctx.stroke();
      head(d, 15.5, -13.5 - 4 * (s.neck - 1));
    }

    function frontal(d, away, wingsOnly) {                              // head-on / tail-on view: wings spread across
      const c = d.col, a = d.a, under = M(c.wing, c.white, .3);
      const wy = -1 - a * 10, ty = 2 - a * 24;
      for (const sx of [-1, 1]) {
        ctx.fillStyle = S(under, away ? .85 : 1);
        ctx.beginPath(); ctx.moveTo(sx * 4, -3.5);
        ctx.quadraticCurveTo(sx * 12, wy - 4, sx * 21, wy - 2.5);
        ctx.quadraticCurveTo(sx * 34, ty - 2, sx * 45, ty);
        ctx.quadraticCurveTo(sx * 33, ty + 2.5, sx * 21, wy + 2.5);
        ctx.quadraticCurveTo(sx * 12, wy + 3, sx * 4, 3);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = S(c.dark, 1, .5);
        ctx.beginPath(); ctx.moveTo(sx * 21, wy - 2.5); ctx.quadraticCurveTo(sx * 34, ty - 2, sx * 45, ty);
        ctx.quadraticCurveTo(sx * 33, ty + 2.5, sx * 21, wy + 2.5); ctx.closePath(); ctx.fill();
      }
      if (wingsOnly) return;
      if (away) {
        ctx.fillStyle = S(c.head); ctx.beginPath(); ctx.arc(0, -5.5, 4, 0, 6.28); ctx.fill();
        ctx.fillStyle = S(c.body); ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 6, 0, 0, 6.28); ctx.fill();
        ctx.fillStyle = S(c.dark); ctx.beginPath(); ctx.moveTo(-2.6, 3); ctx.lineTo(0, 7 + 8 * (d.s.tail - 1)); ctx.lineTo(2.6, 3); ctx.closePath(); ctx.fill();
      } else {
        ctx.fillStyle = S(c.body, .9); ctx.beginPath(); ctx.ellipse(0, 1, 6.5, 6.5, 0, 0, 6.28); ctx.fill();
        ctx.fillStyle = S(c.breast); ctx.beginPath(); ctx.ellipse(0, -.5, 6, 5, 0, 0, 6.28); ctx.fill();
        ctx.fillStyle = S(c.head); ctx.beginPath(); ctx.arc(0, -5.5, 4.6, 0, 6.28); ctx.fill();
        ctx.fillStyle = S(c.bill); ctx.beginPath(); ctx.ellipse(0, -3.6, d.s.bill > 1.3 ? 3.4 : 2.2, 1.8, 0, 0, 6.28); ctx.fill();
        ctx.fillStyle = S(c.dark);
        ctx.beginPath(); ctx.arc(-2.7, -6.4, .7, 0, 6.28); ctx.fill();
        ctx.beginPath(); ctx.arc(2.7, -6.4, .7, 0, 6.28); ctx.fill();
      }
    }

    function floating(d) {                                   // downed bird, low in the water
      const c = d.col;
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(0, 3, 20, 2.4, 0, 0, 6.28); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.rect(-30, -30, 70, 31); ctx.clip();
      ctx.fillStyle = S(c.body, .9); ctx.beginPath(); ctx.ellipse(0, 1, 18, 4.5, .05, 0, 6.28); ctx.fill();
      ctx.fillStyle = S(c.wing, .85); ctx.beginPath(); ctx.ellipse(-6, -1, 14, 2.5, -.2, 0, 6.28); ctx.fill();
      ctx.restore();
      ctx.fillStyle = S(c.head); ctx.beginPath(); ctx.ellipse(19, 0, 4.5, 3, 0, 0, 6.28); ctx.fill();
    }

    function drawDuck(d, t) {
      if (d.delay > 0 || d.hidden) return;
      ctx.save(); ctx.translate(d.x, d.y);
      const facing = (d.state === 'swim' || d.state === 'dead') ? d.dir : (Math.sign(d.vx) || d.dir);
      if (facing < 0) ctx.scale(-1, 1);
      const sc = d.ppf * 2 * d.size / 55, zz = clamp((d.z - .33) / .67, 0, 1);
      ctx.globalAlpha = .62 + .38 * zz;
      if (d.state === 'swim') { ctx.scale(sc, sc); sitting(d); ctx.restore(); return; }
      if (d.state === 'dead') { ctx.scale(sc, sc); floating(d); ctx.restore(); return; }
      if (d.state === 'hit') { ctx.rotate(d.spin); ctx.scale(sc, sc); wing(d, true); body(d); wing(d, false); ctx.restore(); return; }
      const blur = d.pa != null && Math.abs(d.pa - d.a) > .12, ga = ctx.globalAlpha;
      const ghost = fn => { if (!blur) return; const a0 = d.a; d.a = (d.pa + d.a) / 2; ctx.globalAlpha = ga * .35; fn(); d.a = d.pa; ctx.globalAlpha = ga * .18; fn(); d.a = a0; ctx.globalAlpha = ga; };
      if (d.state === 'pass' && Math.abs(d.los) > .8) {
        ctx.rotate(clamp(d.vx / (base(d) + 1) * .5, -.35, .35)); ctx.scale(sc, sc);
        ghost(() => frontal(d, d.los > 0, true)); frontal(d, d.los > 0); ctx.restore(); return;
      }
      const b = base(d), fs = d.state === 'pass' ? Math.max(.5, Math.sqrt(1 - d.los * d.los)) : 1;   // quartering: foreshortened
      let p = Math.atan2(d.vy, Math.max(Math.abs(d.vx), b * .5));
      p = clamp(p, -1.1, .9);
      if (d.state === 'flare') p = -.55;
      if (d.state === 'approach' && d.s.whiffle && d.cup) p += Math.sin(t * 9 + d.wob) * .18;
      ctx.rotate(p); ctx.scale(sc * fs, sc);
      ghost(() => wing(d, true)); wing(d, true); body(d); ghost(() => wing(d, false)); wing(d, false);
      ctx.restore();
    }

    function drawWaterFx() {
      for (const r of ripples) {
        ctx.strokeStyle = `rgba(255,255,255,${(.35 * r.life).toFixed(3)})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(r.x, r.y + 3 * U, r.r * 1.4, r.r * .35, 0, 0, 6.28); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      for (const p of drops) ctx.fillRect(p.x, p.y, 1.4, 1.4);
    }

    function drawFeathers() {
      for (const f of feathers) {
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot);
        ctx.fillStyle = S(f.c, 1.1, Math.min(1, f.life)); ctx.beginPath(); ctx.ellipse(0, 0, f.r, f.r * .35, 0, 0, 6.28); ctx.fill();
        ctx.restore();
      }
    }

    function drawShotFx() {
      for (const f of fx) {
        const a = Math.min(1, f.life / .6);
        ctx.fillStyle = `rgba(255,255,255,${(.08 * a).toFixed(3)})`;
        ctx.strokeStyle = `rgba(255,255,255,${(.6 * a).toFixed(3)})`; ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.28); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        if (showGhost && f.ghost) {
          ctx.strokeStyle = `rgba(232,160,90,${(.9 * a).toFixed(3)})`; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(f.ghost.x, f.ghost.y, Math.max(4, f.ghost.r), 0, 6.28); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.ghost.x, f.ghost.y); ctx.stroke();
        }
      }
    }

    function drawGun() {
      for (const s of gun.smoke) {
        const rg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
        rg.addColorStop(0, `rgba(225,222,215,${(.35 * s.life).toFixed(3)})`); rg.addColorStop(1, 'rgba(225,222,215,0)');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28); ctx.fill();
      }
      if (gun.m <= .001) return;
      const e = 1 - Math.pow(1 - gun.m, 3);
      const tipX = gun.mx, tipY = gun.my + (1 - e) * H * .7 - gun.recoil * 8 * U;
      const bx = W * .5 + (tipX - W * .5) * .35 + W * .05, by = H + 30 * U + gun.recoil * 20 * U;
      const dx = tipX - bx, dy = tipY - by, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      const wB = 40 * U, wT = 5 * U;
      const g = ctx.createLinearGradient(bx + nx * wB, by + ny * wB, bx - nx * wB, by - ny * wB);
      g.addColorStop(0, '#121315'); g.addColorStop(.42, '#3d4046'); g.addColorStop(.5, '#55585e'); g.addColorStop(.58, '#2a2c30'); g.addColorStop(1, '#0c0d0f');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(bx + nx * wB, by + ny * wB); ctx.lineTo(tipX + nx * wT, tipY + ny * wT);
      ctx.lineTo(tipX - nx * wT, tipY - ny * wT); ctx.lineTo(bx - nx * wB, by - ny * wB); ctx.closePath(); ctx.fill();
      // vent rib: posts along the top of the barrel
      ctx.strokeStyle = 'rgba(150,154,160,.55)'; ctx.lineWidth = 1;
      for (let i = 1; i < 14; i++) {
        const f = i / 14, cx = bx + dx * f, cy = by + dy * f, w = (wB + (wT - wB) * f) * .25;
        ctx.beginPath(); ctx.moveTo(cx + nx * w, cy + ny * w); ctx.lineTo(cx - nx * w, cy - ny * w); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(120,124,130,.8)'; ctx.lineWidth = 1.2 * U;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tipX, tipY); ctx.stroke();
      // front bead
      ctx.fillStyle = '#efe6c4'; ctx.beginPath(); ctx.arc(tipX, tipY, 2.4 * U, 0, 6.28); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(tipX - .6 * U, tipY - .6 * U, .8 * U, 0, 6.28); ctx.fill();
    }

    function frame(now) {
      const raw = Math.min(.25, (now - last) / 1000); last = now;
      // vsync jitter (±2 ms) makes motion stutter; follow a smoothed frame interval, but catch up on real stalls
      dtS = raw > .05 ? raw : dtS + (raw - dtS) * .12;
      let dt = raw > .05 ? raw : dtS;
      const t = now / 1000;
      if (!paused) while (dt > 1e-4) { const s = Math.min(dt, 1 / 60); update(s, t); dt -= s; }
      if (bg) { ctx.drawImage(bg, 0, 0, W, H); drawClouds(); drawRipplesLines(paused ? 0 : t); }
      else { ctx.clearRect(0, 0, W, H); drawSky(); drawWater(paused ? 0 : t); }
      ducks.filter(d => d.state === 'swim' || d.state === 'dead').sort((a, b) => a.z - b.z).forEach(d => drawDuck(d, t));
      drawWaterFx();
      drawBlades(t, false);
      ducks.filter(d => d.state !== 'swim' && d.state !== 'dead').sort((a, b) => a.z - b.z).forEach(d => drawDuck(d, t));
      drawFeathers();
      drawBlades(t, true);
      drawShotFx();
      drawGun();
      for (const d of ducks) d.pa = d.a;
      requestAnimationFrame(frame);
    }

    resize();
    new ResizeObserver(() => { if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize(); }).observe(canvas);
    requestAnimationFrame(frame);

    return {
      setConfig(next) {
        const envChanged = next.env && next.env !== cfg.env;
        cfg = Object.assign(cfg, next);
        if (envChanged && W) build();
        if (next.freq && nextEvt > 60 / next.freq[0]) nextEvt = R(1, 60 / next.freq[1]);
      },
      flushNow() { if (!paused) scheduleNext(evFlush()); },
      flushAt(x, y) { if (!paused && y > H * E.horizon) scheduleNext(evFlush(x)); },
      launch(x, y) {                                 // click or F: ducks from a random direction; sometimes a flush at the click
        if (paused || ducks.length >= 120) return;
        const below = y != null && y > H * E.horizon;
        scheduleNext(below && Math.random() < .25 ? evFlush(x) : Math.random() < .08 ? evFlush() : evPass());
      },
      setAim(x, y) { gun.ax = x; gun.ay = y; },
      mount(on) {
        if (paused || on === gun.mounted) return;
        gun.mounted = on;
        if (on) { gun.mountedAt = clock; if (gun.m < .05) { gun.mx = gun.ax; gun.my = gun.ay; } }
        else gun.reload = -.4;
        emitGun();
      },
      fire,
      isMounted: () => gun.mounted,
      setShowGhost(v) { showGhost = v; },
      setPaused(p) { paused = p; if (p && gun.mounted) { gun.mounted = false; emitGun(); } },
      isPaused: () => paused
    };
  };
})();
