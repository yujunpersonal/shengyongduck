/* Audio — synthesized with Web Audio: species calls, wing whistles, flush clatter, splashes, gunfire, marsh ambience.
   Optional real recordings: list them in sounds/manifest.json ({"mallard-hen": "mallard-hen.mp3", "shot": "shot.mp3", ...});
   a recording, when present, replaces the synthesized version of that sound. */
(function () {
  const DF = window.DuckFlight;
  const R = (a, b) => a + Math.random() * (b - a);
  const RI = (a, b) => Math.floor(R(a, b + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const WHISTLE = { mallard: 1700, pintail: 2100, gadwall: 1900, wigeon: 2300, teal: 3100, shoveler: 1800 };

  DF.createAudio = function () {
    let ac = null, master = null, noiseBuf = null, amb = null;
    let enabled = false, volume = .7, envKey = 'wetland', lastCall = 0;
    const samples = {}, voices = new Map();

    const live = () => !!ac && enabled && ac.state === 'running';

    function ensure() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return true; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ac = new AC();
      master = ac.createGain(); master.gain.value = enabled ? volume : 0;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 6; comp.attack.value = .002; comp.release.value = .2;
      master.connect(comp).connect(ac.destination);
      const len = ac.sampleRate * 2;
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const ch = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      startAmbience(); setEnv(envKey); loadSamples();
      return true;
    }

    /* ---------- building blocks ---------- */
    function noise() { const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s; }
    function filt(type, f, q) { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
    function bus(pan, gain) {
      const g = ac.createGain(); g.gain.value = gain;
      if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); p.connect(master); }
      else g.connect(master);
      return g;
    }

    function quack(t, f0, f1, dur, out, amp, rasp, formants) {
      const osc = ac.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f0, t); osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const am = ac.createGain(); am.gain.value = 1 - rasp;
      const nz = noise(), ng = ac.createGain(); ng.gain.value = rasp; nz.connect(ng).connect(am.gain);
      osc.connect(am);
      const sum = ac.createGain(); sum.gain.value = 3;
      formants.forEach((fq, i) => { const bp = filt('bandpass', fq, i ? 7 : 4); am.connect(bp).connect(sum); });
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + .015);
      g.gain.setValueAtTime(amp, t + dur * .55); g.gain.exponentialRampToValueAtTime(.0008, t + dur);
      sum.connect(g).connect(out);
      osc.start(t); osc.stop(t + dur + .05); nz.start(t, Math.random()); nz.stop(t + dur + .05);
    }

    function whistle(t, freqs, dur, out, amp, trill) {
      const osc = ac.createOscillator(); osc.type = 'sine';
      osc.frequency.setValueAtTime(freqs[0], t);
      freqs.slice(1).forEach((f, i, arr) => osc.frequency.linearRampToValueAtTime(f, t + dur * (i + 1) / arr.length));
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + .02);
      g.gain.setValueAtTime(amp, t + dur * .7); g.gain.exponentialRampToValueAtTime(.0008, t + dur);
      if (trill) {
        const l = ac.createOscillator(); l.frequency.value = trill;
        const lg = ac.createGain(); lg.gain.value = .5;
        const am = ac.createGain(); am.gain.value = .5;
        l.connect(lg).connect(am.gain); osc.connect(am).connect(g);
        l.start(t); l.stop(t + dur + .05);
      } else osc.connect(g);
      // a little breath under the tone
      const nz = noise(), bp = filt('bandpass', freqs[0], 12), ng = ac.createGain(); ng.gain.value = .25;
      nz.connect(bp).connect(ng).connect(g);
      g.connect(out);
      osc.start(t); osc.stop(t + dur + .05); nz.start(t, Math.random()); nz.stop(t + dur + .05);
    }

    function hennish(t, o, f0, n, gap) {               // the classic descending hen series
      for (let i = 0; i < n; i++) {
        const f = f0 * (1 - .045 * i), dur = i === 0 ? .2 : .16 - .008 * i;
        quack(t, f, f * .8, dur, o, 1 - .11 * i, .35, [1050, 2400]);
        t += gap - .008 * i;
      }
    }

    /* species voices: (t, out, kind) — kind: flush | hail | chatter | alarm */
    const SYN = {
      mallard: {
        hen(t, o, k) { hennish(t, o, 520 * R(.92, 1.08), k === 'hail' ? RI(5, 7) : k === 'chatter' ? RI(2, 3) : RI(3, 5), .21); },
        drake(t, o) { for (let i = 0, n = RI(1, 2); i < n; i++) quack(t + i * .17, 320, 260, .11, o, .8, .65, [750, 1700]); }
      },
      pintail: {
        hen(t, o) { hennish(t, o, 570 * R(.95, 1.05), RI(2, 3), .19); },
        drake(t, o) { for (let i = 0, n = RI(1, 2); i < n; i++) whistle(t + i * .3, [1600, 1950, 1700], .14, o, .7, 38); }
      },
      gadwall: {
        hen(t, o) { hennish(t, o, 620 * R(.95, 1.05), RI(3, 4), .15); },
        drake(t, o) { for (let i = 0, n = RI(2, 3); i < n; i++) quack(t + i * .14, 230, 195, .08, o, .9, .5, [600, 1300]); }
      },
      wigeon: {
        hen(t, o) { for (let i = 0; i < 2; i++) quack(t + i * .2, 420, 370, .12, o, .7, .8, [800, 1700]); },
        drake(t, o) {
          whistle(t, [1300, 2100], .12, o, .55);
          whistle(t + .16, [2200, 2700, 1900], .28, o, .8);
          whistle(t + .48, [1700, 1250], .14, o, .5);
        }
      },
      teal: {
        hen(t, o) { for (let i = 0, n = RI(2, 4); i < n; i++) quack(t + i * .14, 720, 600, .1, o, .6, .3, [1300, 2800]); },
        drake(t, o) { for (let i = 0, n = RI(2, 3); i < n; i++) whistle(t + i * .22, [2700, 3050, 2600], .1, o, .6, 70); }
      },
      shoveler: {
        hen(t, o) { hennish(t, o, 560 * R(.95, 1.05), RI(3, 4), .17); },
        drake(t, o) { for (let r = 0; r < 2; r++) for (let i = 0; i < 2; i++) quack(t + r * .35 + i * .09, 300, 280, .05, o, .9, .2, [650, 1400]); }
      }
    };

    /* ---------- recordings (optional) ---------- */
    async function loadSamples() {
      try {
        const r = await fetch('sounds/manifest.json');
        if (!r.ok) return;
        const m = await r.json();
        for (const [k, f] of Object.entries(m)) {
          try { samples[k] = await ac.decodeAudioData(await (await fetch('sounds/' + f)).arrayBuffer()); } catch (e) { /* skip bad file */ }
        }
      } catch (e) { /* no manifest: synthesized only */ }
    }
    function playSample(key, pan, gain, delay) {
      const keys = Object.keys(samples).filter(k => k === key || new RegExp('^' + key + '-\\d+$').test(k));
      if (!keys.length) return false;
      const s = ac.createBufferSource(); s.buffer = samples[keys[RI(0, keys.length - 1)]];
      s.playbackRate.value = R(.96, 1.04);
      s.connect(bus(pan, gain)); s.start(ac.currentTime + (delay || 0));
      return true;
    }

    /* ---------- ambience ---------- */
    function startAmbience() {
      const wind = noise(), lp = filt('lowpass', 420, .7), wg = ac.createGain(); wg.gain.value = .05;
      const lfo = ac.createOscillator(); lfo.frequency.value = .08;
      const lg = ac.createGain(); lg.gain.value = .025; lfo.connect(lg).connect(wg.gain);
      wind.connect(lp).connect(wg).connect(master); wind.start(); lfo.start();

      const rustle = noise(), bp = filt('bandpass', 2600, 1.2), rg = ac.createGain(); rg.gain.value = .006;
      const lfo2 = ac.createOscillator(); lfo2.frequency.value = .21;
      const lg2 = ac.createGain(); lg2.gain.value = .004; lfo2.connect(lg2).connect(rg.gain);
      rustle.connect(bp).connect(rg).connect(master); rustle.start(); lfo2.start();

      const lap = noise(), lb = filt('bandpass', 320, .8), la = ac.createGain(); la.gain.value = .015;
      lap.connect(lb).connect(la).connect(master); lap.start();

      // dusk crickets: a pulsed tone, gated
      const cr = ac.createOscillator(); cr.frequency.value = 4400;
      const pulse = ac.createOscillator(); pulse.type = 'square'; pulse.frequency.value = 28;
      const pg = ac.createGain(); pg.gain.value = .5; const ca = ac.createGain(); ca.gain.value = .5;
      pulse.connect(pg).connect(ca.gain); cr.connect(ca);
      const gate = ac.createOscillator(); gate.type = 'square'; gate.frequency.value = 1.6;
      const gg = ac.createGain(); gg.gain.value = .5; const cg = ac.createGain(); cg.gain.value = .5;
      gate.connect(gg).connect(cg.gain); ca.connect(cg);
      const cv = ac.createGain(); cv.gain.value = 0; cg.connect(cv).connect(master);
      cr.start(); pulse.start(); gate.start();

      amb = { wg, rg, la, cv };
    }
    function setEnv(key) {
      envKey = key;
      if (!amb) return;
      const t = ac.currentTime, L = { wetland: [.05, .006, .015, 0], lake: [.07, .002, .025, 0], dusk: [.03, .006, .012, .006], field: [.065, .003, .01, 0] }[key] || [.05, .006, .015, 0];
      amb.wg.gain.setTargetAtTime(L[0], t, .5); amb.rg.gain.setTargetAtTime(L[1], t, .5);
      amb.la.gain.setTargetAtTime(L[2], t, .5); amb.cv.gain.setTargetAtTime(L[3], t, .5);
    }

    /* ---------- events ---------- */
    function call(sp, sex, pan, gain, kind, delay) {
      if (!live()) return;
      const t = ac.currentTime + (delay || 0) + .02;
      if (t - lastCall < .45) return;
      lastCall = t;
      if (playSample(`${sp}-${sex}`, pan, gain, delay)) return;
      const f = SYN[sp] && SYN[sp][sex];
      if (f) f(t, bus(pan, gain * .55), kind);
    }

    function splash(pan, gain, delay) {
      if (!live()) return;
      if (playSample('splash', pan, gain, delay)) return;
      const t = ac.currentTime + (delay || 0), o = bus(pan, gain);
      const src = noise(), lp = filt('lowpass', 3500, .8);
      lp.frequency.setValueAtTime(3500, t); lp.frequency.exponentialRampToValueAtTime(350, t + .6);
      const g = ac.createGain();
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.9, t + .01); g.gain.exponentialRampToValueAtTime(.001, t + .7);
      src.connect(lp).connect(g).connect(o); src.start(t, Math.random()); src.stop(t + .8);
      for (let i = 0; i < 5; i++) {
        const ti = t + .08 + Math.random() * .5, os = ac.createOscillator(), gg = ac.createGain();
        os.frequency.setValueAtTime(R(700, 1500), ti); os.frequency.exponentialRampToValueAtTime(R(1600, 2600), ti + .04);
        gg.gain.setValueAtTime(.0001, ti); gg.gain.exponentialRampToValueAtTime(.12, ti + .005); gg.gain.exponentialRampToValueAtTime(.0001, ti + .05);
        os.connect(gg).connect(o); os.start(ti); os.stop(ti + .06);
      }
    }

    function flush(pan, gain, hz, fromWater, delay) {
      if (!live()) return;
      if (fromWater) splash(pan, gain * .8, delay);
      if (playSample('flush', pan, gain, delay)) return;
      const t = ac.currentTime + (delay || 0), o = bus(pan, gain);
      const src = noise(), bp = filt('bandpass', 1000, .8), g = ac.createGain(); g.gain.value = .0001;
      src.connect(bp).connect(g).connect(o);
      const rate = hz * 1.35, n = Math.round(rate * 1.4);
      for (let i = 0; i < n; i++) {
        const ti = t + i / rate, a = Math.pow(1 - i / n, 1.4) * (i < 3 ? 1.2 : .8);
        g.gain.setValueAtTime(.0001, ti); g.gain.exponentialRampToValueAtTime(Math.max(.002, a), ti + .012);
        g.gain.exponentialRampToValueAtTime(.0005, ti + .6 / rate);
      }
      src.start(t, Math.random()); src.stop(t + n / rate + .1);
    }

    function shot() {
      if (!live()) return;
      if (playSample('shot', 0, 1)) return;
      const t = ac.currentTime, o = bus(0, 1);
      const src = noise(), lp = filt('lowpass', 9000, .7);
      lp.frequency.setValueAtTime(9000, t); lp.frequency.exponentialRampToValueAtTime(220, t + .4);
      const g = ac.createGain();
      g.gain.setValueAtTime(1.4, t); g.gain.exponentialRampToValueAtTime(.3, t + .06); g.gain.exponentialRampToValueAtTime(.001, t + .7);
      src.connect(lp).connect(g).connect(o);
      const th = ac.createOscillator(), tg = ac.createGain();
      th.frequency.setValueAtTime(110, t); th.frequency.exponentialRampToValueAtTime(38, t + .25);
      tg.gain.setValueAtTime(1.2, t); tg.gain.exponentialRampToValueAtTime(.001, t + .35);
      th.connect(tg).connect(o);
      [[.42, .22], [.95, .08]].forEach(([d, a]) => {           // echoes off the far shore
        const dl = ac.createDelay(2); dl.delayTime.value = d;
        const el = filt('lowpass', 900, .7), eg = ac.createGain(); eg.gain.value = a;
        g.connect(dl).connect(el).connect(eg).connect(master);
      });
      src.start(t, Math.random()); src.stop(t + 1.2); th.start(t); th.stop(t + .4);
    }

    function click(kind) {
      if (!live()) return;
      const t = ac.currentTime, o = bus(.35, kind === 'empty' ? .5 : .35);
      const n = kind === 'load' ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const ti = t + i * .07, src = noise(), hp = filt('highpass', kind === 'empty' ? 2500 : 1800, .7), g = ac.createGain();
        g.gain.setValueAtTime(.0001, ti); g.gain.exponentialRampToValueAtTime(1, ti + .002); g.gain.exponentialRampToValueAtTime(.0001, ti + .03);
        src.connect(hp).connect(g).connect(o); src.start(ti, Math.random()); src.stop(ti + .05);
      }
    }

    /* wing whistle voices for the loudest few birds, modulated by each bird's wing stroke */
    function updateWings(ducks, W) {
      if (!live()) { if (voices.size && ac) { for (const v of voices.values()) v.src.stop(); voices.clear(); } return; }
      const t = ac.currentTime;
      const cand = ducks.map(d => ({ d, l: Math.pow(15 / d.D, 1.5) * (d.state === 'flush' ? 1.4 : 1) }))
        .sort((a, b) => b.l - a.l).slice(0, 6);
      const keep = new Set(cand.map(c => c.d));
      for (const [d, v] of voices) if (!keep.has(d)) { v.g.gain.setTargetAtTime(0, t, .05); v.src.stop(t + .3); voices.delete(d); }
      for (const { d, l } of cand) {
        let v = voices.get(d);
        if (!v) {
          const src = noise(), bp = filt('bandpass', WHISTLE[d.k] || 1900, 5), lp = filt('lowpass', 520, .7);
          const hi = ac.createGain(), lo = ac.createGain(), g = ac.createGain();
          hi.gain.value = 1; lo.gain.value = .35; g.gain.value = 0;
          src.connect(bp).connect(hi).connect(g); src.connect(lp).connect(lo).connect(g);
          let p = null;
          if (ac.createStereoPanner) { p = ac.createStereoPanner(); g.connect(p); p.connect(master); } else g.connect(master);
          src.start(t, Math.random());
          v = { src, bp, lo, g, p }; voices.set(d, v);
        }
        if (v.p) v.p.pan.setTargetAtTime(clamp(d.x / W * 2 - 1, -1, 1), t, .03);
        const f = WHISTLE[d.k] || 1900;
        let gain;
        if (d.cup) {                     // cupped wings: steady tearing-air rush
          gain = l * .2 * (.85 + .15 * Math.sin(d.ph * 2));
          v.bp.frequency.setTargetAtTime(f * .65, t, .05); v.lo.gain.setTargetAtTime(.9, t, .05);
        } else if (d.glide > 0) {
          gain = l * .04;
        } else {
          gain = l * .15 * (.15 + .85 * Math.abs(Math.sin(d.ph)));
          v.bp.frequency.setTargetAtTime(f, t, .05); v.lo.gain.setTargetAtTime(.35, t, .05);
        }
        v.g.gain.setTargetAtTime(gain, t, .012);
      }
    }

    return {
      unlock() { if (enabled) ensure(); },
      setEnabled(on) { enabled = on; if (on) ensure(); if (master) master.gain.setTargetAtTime(on ? volume : 0, ac.currentTime, .05); },
      setVolume(v) { volume = v; if (master && enabled) master.gain.setTargetAtTime(v, ac.currentTime, .05); },
      setEnv, call, splash, flush, shot, click, updateWings,
      get enabled() { return enabled; }
    };
  };
})();
