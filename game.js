(() => {
  'use strict';
  const C = window.HwarakCore;
  const assets = window.HwarakAssets;
  const quality = new window.HwarakQuality.Controller();
  const $ = id => document.getElementById(id);
  const stage = $('stage'), canvas = $('game-canvas'), ctx = canvas.getContext('2d', { alpha: false });
  const openingVideo = $('opening-video');
  const pads = [...document.querySelectorAll('.key-pad')];
  const COLORS = ['#ffdf32', '#21f5f3', '#ff42c8', '#ad79ff'];
  const JUDGE_COLORS = { perfect: '#fff18b', special: '#ff82e7', great: '#6dffff', good: '#c7afff', miss: '#ff739d', stray: '#ff739d' };
  const CODE_TO_LANE = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
  const POSE_MASK = { 1: 'D', 2: 'F', 4: 'J', 8: 'K', 9: 'DK', 6: 'FJ', 5: 'DJ', 10: 'FK' };
  const INTRO_DURATION = 3.5; // Three one-second Ready pumps, then half a second of Go.
  const HIT_LIGHT_DURATION = .78;
  const NOTE_WIDTH = .116;
  const POSES = { normal: true, D: true, F: true, J: true, K: true, DK: true, FJ: true, DJ: true, FK: true, DF: true, JK: true };
  const ENCORE_POSES = ['DF', 'JK', 'DF', 'JK', 'FJ'];
  const textures = {};
  const otterMaterials = {};
  const skeletonTextures = {};
  const moteTextures = new Map();
  const staticLayers = new Map();
  let renderRatio = 1;
  const sources = [new Set(), new Set(), new Set(), new Set()];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const storeGet = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
  const storeSet = (key, value) => { try { localStorage.setItem(key, String(value)); } catch {} };
  let width = 1400, height = 800, phone = false, ready = false, session = null;
  let mode = 'opening', time = -INTRO_DURATION, baseTime = -INTRO_DURATION, anchor = 0, manual = false;
  let openingPlayPending = false, revealTimer = null, titleLogoLoaded = false;
  let pose = 'normal', lastLane = 0, lastFrame = performance.now(), resumeRemaining = 0, lastHitTime = -99;
  let fx = [], feedback = null, phaseAnnounced = false;
  let intermissionElapsed = 0, phaseOneScore = 0, encoreBeat = -1, titleElapsed = 0;
  let best = Math.max(0, Number(storeGet('hwarak-best-v2', '0')) || 0);
  const audio = { ctx: null, gain: null, enabled: storeGet('hwarak-sound', 'true') !== 'false', nextBeat: -7, nodes: new Set() };
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const setText = (id, text) => { const el = $(id); if (el.textContent !== text) el.textContent = text; };
  const visible = (id, show) => { $(id).hidden = !show; };
  const randomSeed = () => { try { return crypto.getRandomValues(new Uint32Array(1))[0]; } catch { return Date.now() >>> 0; } };
  const currentTime = () => mode === 'playing' && !manual ? baseTime + (performance.now() - anchor) / 1000 : time;
  const formatTime = (seconds, precise = false) => {
    const ticks = Math.floor(Math.max(0, seconds) * 10 + 1e-6), whole = Math.floor(ticks / 10);
    return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}${precise ? '.' + ticks % 10 : ''}`;
  };
  const target = lane => ({ x: width * (.155 + lane * .23), y: height * .845 });
  const horizon = () => height * (phone ? .425 : .42);
  const noteHorizon = () => height * .59;

  function rect(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h)); }
  function poly(points, color, stroke, line = 1, painter = ctx) {
    const ctx = painter;
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
    ctx.fillStyle = color; ctx.fill(); if (stroke) { ctx.lineWidth = line; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function text(value, x, y, size, color, align = 'center', weight = 800) {
    ctx.fillStyle = color; ctx.font = `${weight} ${size}px Festival, system-ui, sans-serif`; ctx.textAlign = align; ctx.fillText(value, x, y);
  }
  function star(x, y, size, color) {
    poly([[x, y - size], [x + size * .23, y - size * .23], [x + size, y], [x + size * .23, y + size * .23], [x, y + size], [x - size * .23, y + size * .23], [x - size, y], [x - size * .23, y - size * .23]], color);
  }
  function projection(lane, u) {
    const depth = (1 / (2.35 - 1.35 * clamp(u, 0, 1.035)) - 1 / 2.35) / (1 - 1 / 2.35);
    const end = target(lane);
    return { x: lerp(width * .5, end.x, depth), y: lerp(noteHorizon(), end.y, depth), scale: .035 + .965 * depth, depth };
  }
  function noteShape(lane, u) {
    // The leading edge reaches the line at the hit time. Late-input grace never
    // carries the solid note below the line.
    const p = projection(lane, Math.min(1, u));
    return { ...p, w: width * NOTE_WIDTH * p.scale, h: Math.max(2.3, height * .009 * p.scale) };
  }


  function bloom(x, y, radius, color, strength = 1, flatten = 1, painter = ctx) {
    const ctx = painter;
    ctx.save(); ctx.translate(x, y); ctx.scale(1, flatten);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    glow.addColorStop(0, color + 'b0'); glow.addColorStop(.28, color + '60'); glow.addColorStop(1, color + '00');
    ctx.globalAlpha *= clamp(strength); ctx.fillStyle = glow; ctx.fillRect(-radius, -radius, radius * 2, radius * 2); ctx.restore();
  }
  function lightMote(x, y, radius, color) {
    // Cache the soft glow so a dense fountain of tiny lights stays inexpensive.
    if (!moteTextures.has(color)) {
      const sprite = document.createElement('canvas'); sprite.width = sprite.height = 32;
      const painter = sprite.getContext('2d'), glow = painter.createRadialGradient(16, 16, 0, 16, 16, 16);
      glow.addColorStop(0, '#ffffff'); glow.addColorStop(.13, '#ffffff');
      glow.addColorStop(.25, color); glow.addColorStop(.45, color + '75'); glow.addColorStop(1, color + '00');
      painter.fillStyle = glow; painter.fillRect(0, 0, 32, 32); moteTextures.set(color, sprite);
    }
    ctx.drawImage(moteTextures.get(color), x - radius, y - radius, radius * 2, radius * 2);
  }
  function hitLight(lane, start, seed) {
    let state = (Math.imul(seed + 1, 2654435761) ^ (lane + 1)) >>> 0;
    const sample = () => {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
    return { lane, start, motes: Array.from({ length: quality.profile.motes }, () => ({ a: sample(), b: sample(), c: sample() })) };
  }
  function beatMotion(t) {
    if (reducedMotion) return { bounce: 0, squash: 0, pulse: .3 };
    const phase = ((t % C.BEAT) + C.BEAT) % C.BEAT / C.BEAT;
    return { bounce: Math.sin(Math.PI * phase) ** 2, squash: Math.exp(-phase * 16), pulse: Math.exp(-phase * 9) };
  }
  function openingCue(t) {
    if (t >= 0 || t < -INTRO_DURATION) return null;
    const elapsed = t + INTRO_DURATION, isGo = elapsed >= 3;
    const phase = isGo ? (elapsed - 3) / .5 : elapsed % 1;
    return { label: isGo ? 'Go' : 'Ready?', pulse: isGo ? 0 : Math.floor(elapsed) + 1,
      scale: reducedMotion ? 1 : isGo ? 1 + Math.sin(Math.PI * phase) * .22 : .9 + Math.sin(Math.PI * Math.min(1, phase / .65)) * .24,
      opacity: reducedMotion ? 1 : isGo ? Math.min(1, (1 - phase) * 5) : Math.min(1, (1 - phase) * 5) };
  }
  function drawCountdown() {
    const cue = mode === 'resuming' ? openingCue(-resumeRemaining / 1.5 * INTRO_DURATION) : mode === 'playing' ? openingCue(time) : null;
    visible('countdown', !!cue);
    if (!cue) return;
    setText('countdown-word', cue.label);
    $('countdown').dataset.cue = cue.label === 'Go' ? 'go' : 'ready';
    $('countdown-word').style.transform = `scale(${cue.scale})`;
    $('countdown-word').style.opacity = cue.opacity;
  }
  function makeOtterMaterial(image) {
    const makeLayer = color => {
      const layer = document.createElement('canvas'); layer.width = 600; layer.height = 512;
      const painter = layer.getContext('2d'); painter.drawImage(image, 0, 0);
      if (color) {
        painter.globalCompositeOperation = 'source-in'; painter.fillStyle = color; painter.fillRect(0, 0, 600, 512);
      } else {
        painter.globalCompositeOperation = 'source-atop';
        const wash = painter.createLinearGradient(130, 0, 455, 0);
        wash.addColorStop(0, '#19f5ff80'); wash.addColorStop(.36, '#42ddff15');
        wash.addColorStop(.56, '#ff44ce10'); wash.addColorStop(1, '#ff42c878');
        painter.fillStyle = wash; painter.fillRect(0, 0, 600, 512);
      }
      return layer;
    };
    return { body: makeLayer(), cyan: makeLayer('#32efff'), pink: makeLayer('#ff4acb') };
  }
  function heroLayout() {
    const feet = height * .615;
    const safeTop = height * (phone ? .25 : .19);
    const head = Math.min(height * .145, width * (height > width ? .155 : .115), (feet - safeTop) / 2.75);
    return { x: width * .5, feet, head, figureHeight: head * 2.7 };
  }
  function titleHeroLayout() {
    const portrait = height > width;
    const head = Math.min(height * .11, width * (portrait ? .095 : .052));
    return { x: width * (portrait ? .5 : .20), feet: height * (portrait ? .94 : .79), head, figureHeight: head * 2.7 };
  }
  function displayPose() {
    if (mode === 'title' || mode === 'revealing') return Math.floor(titleElapsed) % 2 ? 'JK' : 'DF';
    if (session?.phase === 1 && (mode === 'intermission' || mode === 'result')) return ENCORE_POSES[Math.min(4, Math.floor(intermissionElapsed))];
    return pose;
  }
  function sideDancerLayout(t) {
    if (!session || (session.phase === 1 && t < C.PRACTICE)) return [];
    const hero = heroLayout(), figureHeight = hero.figureHeight * .79;
    const opacity = session.phase === 2 ? 1 : clamp((t - C.PRACTICE) / .7);
    return [.235, .765].map((x, index) => ({ x: width * x, feet: height * .615, figureHeight,
      head: figureHeight * 52 / 432, opacity, pose: displayPose(), kind: 'skeleton', color: index ? '#fa68e0' : '#53f4ff' }));
  }
  function drawSideDancers(t) {
    const motion = beatMotion(t), impact = reducedMotion ? 0 : Math.max(0, 1 - (t - lastHitTime) / .2);
    for (const dancer of sideDancerLayout(t)) {
      const image = skeletonTextures[dancer.pose]; if (!image) continue;
      const scale = dancer.figureHeight / 432, bounce = (motion.bounce * .065 + impact * .018) * dancer.figureHeight;
      ctx.save(); ctx.globalAlpha = dancer.opacity;
      bloom(dancer.x, dancer.feet, dancer.figureHeight * .44, dancer.color, .4 + motion.pulse * .25, .12);
      ctx.translate(dancer.x, dancer.feet - bounce);
      if (!reducedMotion) ctx.rotate(Math.sin(t * Math.PI * 4) * .028);
      ctx.scale(1 + motion.squash * .04, 1 - motion.squash * .055);
      ctx.imageSmoothingEnabled = false;
      ctx.shadowColor = dancer.color; ctx.shadowBlur = 8 + motion.pulse * 5;
      ctx.drawImage(image, -256 * scale, -480 * scale, 512 * scale, 512 * scale); ctx.restore();
    }
  }
  function cachedLayer(name, draw) {
    if (!staticLayers.has(name)) {
      const layer = document.createElement('canvas'); layer.width = canvas.width; layer.height = canvas.height;
      const painter = layer.getContext('2d'); painter.setTransform(renderRatio, 0, 0, renderRatio, 0, 0);
      draw(painter); staticLayers.set(name, layer);
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(staticLayers.get(name), 0, 0); ctx.restore();
  }
  function drawStaticBackdrop(ctx) {
    ctx.fillStyle = '#0a0420'; ctx.fillRect(0, 0, width, height);
    const bg = textures.background, hy = horizon();
    if (bg) {
      const scale = Math.max(width / bg.naturalWidth, height * 1.34 / bg.naturalHeight);
      const w = bg.naturalWidth * scale, h = bg.naturalHeight * scale;
      ctx.drawImage(bg, (width - w) / 2, hy - h * .552, w, h);
    }
    // Keep the open dance floor legible without a separator between stage and notes.
    const floor = ctx.createLinearGradient(0, hy * .7, 0, height);
    floor.addColorStop(0, '#11062600'); floor.addColorStop(.35, '#13082965'); floor.addColorStop(1, '#100923e6');
    ctx.fillStyle = floor; ctx.fillRect(0, 0, width, height);
    const top = ctx.createLinearGradient(0, 0, 0, height * .3);
    top.addColorStop(0, '#08051af2'); top.addColorStop(.55, '#08051aad'); top.addColorStop(1, '#08051a00');
    ctx.fillStyle = top; ctx.fillRect(0, 0, width, height * .3);
  }
  function drawBackdrop(t, isMenu) {
    cachedLayer('background', drawStaticBackdrop);
    const hy = horizon(), beat = beatMotion(t);
    const sway = reducedMotion ? 0 : Math.sin(t * .7) * .08;
    for (const side of [-1, 1]) {
      const sx = width * (.5 + side * .35), sy = hy * .48;
      const light = ctx.createLinearGradient(0, sy, 0, height * .92);
      light.addColorStop(0, side < 0 ? '#25f4ff75' : '#ff27d575'); light.addColorStop(1, '#ad59ff00');
      ctx.save(); ctx.globalAlpha = .3 + beat.pulse * .3;
      poly([[sx - 4, sy], [sx + 4, sy], [width * (.5 + side * (.16 + sway)), height * .91], [width * (.5 + side * (.35 + sway)), height * .91]], light);
      ctx.restore();
      bloom(sx, sy, width * .06, side < 0 ? '#22e9ff' : '#ff32e4', .6 + beat.pulse * .4);
    }
    bloom(width * .5, hy, width * .15, '#e655ff', .45 + beat.pulse * .3, .27);
    for (let i = 0; i < 18; i++) {
      const x = width * ((i * .137 + .03) % 1), y = height * (.13 + ((i * .071) % .24));
      const a = .4 + Math.sin(t * 1.7 + i) * .2;
      ctx.save(); ctx.globalAlpha = a; star(x, y, Math.max(1.5, width * .0016), i % 2 ? '#6cffff' : '#ffc2fa'); ctx.restore();
    }
    if (isMenu) {
      const wash = ctx.createLinearGradient(0, 0, width * .8, 0);
      wash.addColorStop(0, '#100826f2'); wash.addColorStop(.6, '#16082ac7'); wash.addColorStop(1, '#16082a00');
      ctx.fillStyle = wash; ctx.fillRect(0, 0, width, height);
      star(width * .91, height * .42, width * .018, '#ff81e4');
      star(width * .56, height * .67, width * .013, '#64ffff');
    }
  }
  function drawLaneLayer(ctx) {
    const hy = noteHorizon();
    for (let lane = 0; lane < 4; lane++) {
      const end = target(lane);
      const fade = ctx.createLinearGradient(0, hy, 0, height);
      fade.addColorStop(0, COLORS[lane] + '00'); fade.addColorStop(.24, COLORS[lane] + 'b0');
      fade.addColorStop(.78, COLORS[lane] + 'ee'); fade.addColorStop(1, COLORS[lane] + '00');
      // Nested translucent light cones create feathered paths, with no lane rails.
      ctx.save(); ctx.globalAlpha = .016;
      for (let step = 18; step > 0; step--) {
        const extension = (height - hy) / (end.y - hy), half = width * .093 * extension * step / 18;
        const x = width / 2 + (end.x - width / 2) * extension;
        poly([[width / 2, hy], [x + half, height], [x - half, height]], fade, null, 1, ctx);
      }
      ctx.restore();
      for (const u of [.34, .54, .70, .84]) {
        const p = projection(lane, u);
        ctx.save(); ctx.globalAlpha = .3;
        bloom(p.x, p.y, Math.max(3, width * .012 * p.scale), COLORS[lane], .6, .3, ctx);
        ctx.restore();
      }
    }
  }
  function drawCharacter(t, shownPose = displayPose(), layout = heroLayout(), energy = 1) {
    const material = otterMaterials[shownPose] || otterMaterials.normal; if (!material) return;
    const { x, feet, head } = layout, scale = head / 128, motion = beatMotion(t);
    const impact = reducedMotion ? 0 : Math.max(0, 1 - (t - lastHitTime) / .2);
    const bounce = motion.bounce * head * .14 * energy + impact * head * .045;
    const squash = motion.squash * .065;
    bloom(x - head * .55, feet, head * 1.8, '#31eaff', .65 + motion.pulse * .2, .16);
    bloom(x + head * .6, feet, head * 1.5, '#ff42c8', .5 + motion.pulse * .2, .14);
    ctx.save(); ctx.translate(x, feet - bounce); ctx.scale(1 + squash, 1 - squash);
    if (!reducedMotion && energy !== 1) ctx.rotate(Math.sin(t * Math.PI * 2) * .018 * energy);
    ctx.imageSmoothingEnabled = false;
    const w = 600 * scale, h = 512 * scale, left = -300 * scale, top = -470 * scale;
    const rim = Math.max(1.3, head * .023);
    ctx.shadowColor = '#16eaff'; ctx.shadowBlur = 12 + motion.pulse * 5;
    ctx.drawImage(material.cyan, left - rim, top, w, h);
    ctx.shadowColor = '#ff39c7'; ctx.shadowBlur = 10 + motion.pulse * 5;
    ctx.drawImage(material.pink, left + rim, top - rim * .3, w, h);
    ctx.shadowBlur = 0; ctx.drawImage(material.body, left, top, w, h);
    ctx.restore();
  }
  function drawJudgementLine(t, notes) {
    const beat = beatMotion(t), y = target(0).y, left = width * .035, right = width * .965;
    const palette = ctx.createLinearGradient(left, y, right, y);
    palette.addColorStop(0, COLORS[0] + '00');
    for (let lane = 0; lane < 4; lane++) palette.addColorStop((target(lane).x - left) / (right - left), COLORS[lane]);
    palette.addColorStop(1, COLORS[3] + '00');
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let lane = 0; lane < 4; lane++) {
      ctx.globalAlpha = 1;
      const p = target(lane), down = sources[lane].size > 0;
      const arriving = notes.find(n => n.lanes.includes(lane) && !n.inputs[lane] && n.hit - t >= 0 && n.hit - t < .24);
      const approach = arriving ? (1 - (arriving.hit - t) / .24) ** 2 : 0;
      bloom(p.x, y, width * .155, COLORS[lane], .44 + beat.pulse * .07, height / width * .38);
      bloom(p.x, y, width * .108, COLORS[lane], .5 + approach * .25 + (down ? .25 : 0), .075);
      if (approach || down) bloom(p.x, y, width * .09, '#ffffff', down ? .65 : approach * .28, .035);
      // A quiet dusting on the line, without orbiting or gathering particles.
      for (let i = 0; i < quality.profile.dust; i++) {
        const seed = ((i * 47 + lane * 29) % 101) / 101;
        const phase = reducedMotion ? seed : (t * (.24 + seed * .18) + i * .618) % 1;
        const x = p.x + (seed - .5) * width * .22;
        ctx.globalAlpha = Math.sin(phase * Math.PI) * .38;
        lightMote(x, y - phase * height * .021, Math.max(1.4, width * .0017), COLORS[lane]);
      }
    }
    ctx.globalAlpha = 1; ctx.strokeStyle = palette; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y);
    for (const [thickness, alpha] of [[14, .07], [7, .17], [3.5, .55]]) {
      ctx.lineWidth = thickness; ctx.globalAlpha = alpha; ctx.stroke();
    }
    // One continuous contact line: no boxes, tiles, gaps or vertical boundaries.
    const core = ctx.createLinearGradient(left, y, right, y);
    core.addColorStop(0, '#ffffff00'); core.addColorStop(.055, '#ffffff');
    core.addColorStop(.945, '#ffffff'); core.addColorStop(1, '#ffffff00');
    ctx.strokeStyle = core; ctx.globalAlpha = .85; ctx.lineWidth = Math.max(1, height * .0016); ctx.stroke();
    ctx.strokeStyle = palette; ctx.lineWidth = 1; ctx.globalAlpha = .65;
    ctx.beginPath();
    for (let i = 0; i <= 300; i++) {
      const x = lerp(left, right, i / 300), motion = reducedMotion ? 0 : t * 3;
      const flutter = Math.sin(i * 2.37 + motion) * Math.sin(i * .73 - motion) * Math.sin(i * .23) * Math.max(1.3, height * .0035);
      if (i === 0) ctx.moveTo(x, y + flutter); else ctx.lineTo(x, y + flutter);
    }
    ctx.stroke(); ctx.restore();
  }
  function drawNote(note, t) {
    const u = (t - note.spawn) / note.travel;
    const pending = note.lanes.filter(lane => !note.inputs[lane]);
    ctx.save(); ctx.globalAlpha = 1 - clamp((t - note.hit) / C.GOOD) * .8;
    if (pending.length === 2) {
      const a = noteShape(pending[0], u), b = noteShape(pending[1], u);
      const inset = a.w * .5, y = a.y - a.h / 2;
      if (b.x - a.x > inset * 2) {
        const color = ctx.createLinearGradient(a.x, y, b.x, y);
        color.addColorStop(0, COLORS[pending[0]]); color.addColorStop(.5, '#e8eaff'); color.addColorStop(1, COLORS[pending[1]]);
        ctx.save(); ctx.strokeStyle = color; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(a.x + inset, y); ctx.lineTo(b.x - inset, y);
        // A soft, thin link belongs to this chord and moves in perspective with it.
        ctx.globalAlpha *= .12; ctx.lineWidth = Math.max(2, a.scale * 4); ctx.stroke();
        ctx.globalAlpha *= 3; ctx.lineWidth = Math.max(.7, a.scale * 1.1); ctx.stroke();
        ctx.restore();
      }
    }
    for (const lane of pending) {
      const p = noteShape(lane, u), { w, h } = p;
      const cy = p.y - h / 2;
      bloom(p.x, cy, w * .66, COLORS[lane], .8, .13);
      const tail = noteShape(lane, Math.max(0, Math.min(1, u) - .03));
      const trail = ctx.createLinearGradient(tail.x, tail.y, p.x, cy);
      trail.addColorStop(0, COLORS[lane] + '00'); trail.addColorStop(1, COLORS[lane] + '50');
      poly([[tail.x - tail.w * .35, tail.y - h], [tail.x + tail.w * .35, tail.y - h], [p.x + w * .4, cy], [p.x - w * .4, cy]], trail);
      const fill = ctx.createLinearGradient(0, p.y - h, 0, p.y);
      fill.addColorStop(0, COLORS[lane]); fill.addColorStop(.5, '#f9ffff'); fill.addColorStop(1, COLORS[lane]);
      ctx.save(); ctx.shadowColor = COLORS[lane]; ctx.shadowBlur = Math.max(5, 11 * p.scale);
      ctx.fillStyle = fill; ctx.beginPath();
      ctx.roundRect(p.x - w / 2, p.y - h, w, h, Math.min(3, h / 2)); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
  function drawEffects(now) {
    fx = fx.filter(effect => now - effect.start < HIT_LIGHT_DURATION);
    for (const effect of fx) {
      const elapsed = now - effect.start, age = clamp(elapsed / HIT_LIGHT_DURATION);
      const p = effect.position ? { x: effect.position.x * width, y: effect.position.y * height } : target(effect.lane);
      const color = COLORS[effect.lane], size = Math.max(35, width * .07) * (effect.sizeFactor || 1), rise = height * (effect.riseFactor || .25);
      const fade = (1 - age) ** 1.5, flash = Math.exp(-elapsed * 14);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      // A forceful contact flash stays on the line; fine particles carry the light upward.
      bloom(p.x, p.y, size * (1.8 + age * .4), color, fade, .3);
      bloom(p.x, p.y, size * 1.15, '#ffffff', flash + fade * .3, .14);
      bloom(p.x, p.y, size * 1.9, '#ffffff', flash * .95, .035);
      const flare = ctx.createLinearGradient(p.x - size * 1.5, 0, p.x + size * 1.5, 0);
      flare.addColorStop(0, color + '00'); flare.addColorStop(.27, color);
      flare.addColorStop(.5, '#ffffff'); flare.addColorStop(.73, color); flare.addColorStop(1, color + '00');
      ctx.strokeStyle = flare; ctx.lineWidth = Math.max(2, height * .006) * (1 + flash);
      ctx.globalAlpha = fade; ctx.beginPath(); ctx.moveTo(p.x - size * 1.5, p.y); ctx.lineTo(p.x + size * 1.5, p.y); ctx.stroke();
      if (!reducedMotion) {
        // Soft drifting light behind the fountain, with no solid ribbons or spikes.
        ctx.globalAlpha = 1;
        for (let i = 0; i < 5; i++) {
          const shift = Math.sin(i * 2.4 + age * 3) * size * (.16 + age * .35);
          const lift = rise * (.08 + age * (.35 + i * .10));
          bloom(p.x + shift, p.y - lift, size * (.3 + i * .035), color, fade * .27, 1.25);
        }
        // Staggered tiny white-centered motes make a rich, natural spray of light.
        for (let i = 0; i < Math.min(effect.motes.length, quality.profile.motes); i++) {
          const { a, b, c } = effect.motes[i];
          const delay = c * .12, life = .36 + a * .29, progress = (elapsed - delay) / life;
          if (progress < 0 || progress > 1) continue;
          const drift = (a - .5) * size * (1.05 + progress * 1.45);
          const curl = Math.sin(progress * 5 + b * Math.PI * 2) * size * progress * .22;
          const x = p.x + drift + curl;
          const y = p.y - Math.sin(progress * Math.PI * .62) * rise * (.15 + b * .85);
          const twinkle = .65 + .35 * Math.sin(progress * 19 + i) ** 2;
          ctx.globalAlpha = Math.min(1, (1 - progress) * 2.5) * (.6 + b * .4) * twinkle;
          lightMote(x, y, Math.max(1.9, width / 1400 * (2.3 + c * 2.5)) * (1 - progress * .24), i % 4 ? color : '#ffffff');
          if (i % 7 === 0) {
            ctx.globalAlpha *= .24;
            lightMote(x - drift * .03, y + 3 + b * 4, Math.max(1.6, width * .002), color);
          }
        }
      }
      ctx.restore();
    }
    if (feedback && now - feedback.start < .7) {
      const age = (now - feedback.start) / .7, size = Math.max(20, Math.min(44, height * .055));
      const pop = reducedMotion ? 1 : 1 + Math.sin(Math.min(1, age * 5) * Math.PI) * .2;
      ctx.save(); ctx.globalAlpha = Math.min(1, (1 - age) * 4);
      ctx.translate(width * .5, height * .72); ctx.scale(pop, pop);
      ctx.font = `900 ${size}px Festival, system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.strokeStyle = '#170a31'; ctx.lineWidth = 6; ctx.strokeText(feedback.label, 0, 0);
      ctx.shadowColor = feedback.color; ctx.shadowBlur = 18; ctx.fillStyle = feedback.color; ctx.fillText(feedback.label, 0, 0);
      ctx.shadowBlur = 0;
      text(feedback.detail, 0, size * .58, Math.max(10, size * .36), '#ffffff');
      ctx.restore();
    }
  }
  function render(now) {
    const inGame = !!session, titleDance = mode === 'title' || mode === 'revealing';
    const t = inGame ? Math.max(0, time) + intermissionElapsed : titleDance ? titleElapsed : now;
    drawBackdrop(t, false);
    if (titleDance) drawCharacter(t * .5, displayPose(), titleHeroLayout(), .65);
    if (inGame) { drawSideDancers(t); cachedLayer('lanes', drawLaneLayer); drawCharacter(t, displayPose(), heroLayout(), mode === 'intermission' ? 1.35 : 1); }
    if (inGame) {
      const notes = session ? session.visible(time) : [];
      drawJudgementLine(t, notes);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, target(0).y); ctx.clip();
      notes.sort((a, b) => b.hit - a.hit).forEach(note => drawNote(note, time));
      ctx.restore();
      drawEffects(time + intermissionElapsed);
    }
  }

  async function initAudio() {
    if (!audio.enabled) return;
    try {
      if (!audio.ctx) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        audio.ctx = new Audio(); audio.gain = audio.ctx.createGain(); audio.gain.gain.value = .18; audio.gain.connect(audio.ctx.destination);
      }
      if (audio.ctx.state === 'suspended') await audio.ctx.resume();
      updateSoundUI();
    } catch { /* Audio is optional; the visual beat is always available. */ }
  }
  function tone(when, frequency, duration, volume, kick = false) {
    if (!audio.enabled || !audio.ctx || audio.ctx.state !== 'running' || manual) return;
    const oscillator = audio.ctx.createOscillator(), gain = audio.ctx.createGain();
    oscillator.type = kick ? 'sine' : 'triangle'; oscillator.frequency.setValueAtTime(frequency, when);
    if (kick) oscillator.frequency.exponentialRampToValueAtTime(45, when + duration);
    gain.gain.setValueAtTime(volume, when); gain.gain.exponentialRampToValueAtTime(.001, when + duration);
    oscillator.connect(gain); gain.connect(audio.gain); oscillator.start(when); oscillator.stop(when + duration + .01);
    audio.nodes.add(oscillator); oscillator.onended = () => { audio.nodes.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
  }
  function stopAudio() { for (const node of audio.nodes) { try { node.stop(); } catch {} } audio.nodes.clear(); }
  function scheduleBeat() {
    if (!audio.ctx || !audio.enabled || manual || mode !== 'playing') return;
    const end = Math.floor((time + .12) / C.BEAT);
    for (let beat = audio.nextBeat; beat <= end; beat++) {
      const at = beat * C.BEAT;
      if (at >= time - .015 && (session?.phase === 2 || at < C.DURATION)) {
        const when = audio.ctx.currentTime + Math.max(.003, at - time);
        tone(when, beat % 4 === 0 ? 140 : 100, .075, beat % 4 === 0 ? .7 : .44, true);
      }
    }
    audio.nextBeat = end + 1;
  }
  function updateSoundUI() {
    const active = audio.enabled && audio.ctx?.state === 'running';
    $('sound-toggle').setAttribute('aria-pressed', String(!!active));
    $('sound-toggle').setAttribute('aria-label', active ? '박자음 켜짐, 누르면 끄기' : '누르면 박자음 켜기');
    document.querySelector('.sound-label').textContent = active ? '박자음 ON' : audio.enabled ? '박자음 켜기' : '박자음 OFF';
  }
  function onJudge(event) {
    const note = event.noteId == null ? null : session?.chart.find(note => note.id === event.noteId);
    if (note && session.phase === 1 && time - note.hit > .45) return;
    const now = time;
    if (event.judgement !== 'miss' && event.judgement !== 'stray') {
      for (const lane of event.lanes) fx.push(hitLight(lane, now, event.noteId || 0));
      const mask = event.lanes.reduce((value, lane) => value | (1 << lane), 0);
      pose = POSE_MASK[mask] || C.KEYS[event.lanes[0]]; lastHitTime = time;
      if (audio.ctx) tone(audio.ctx.currentTime + .002, 470 + event.lanes[0] * 90, .035, .14);
    }
    feedback = { start: now, label: event.judgement === 'stray' ? 'MISS' : event.judgement.toUpperCase(), color: JUDGE_COLORS[event.judgement],
      detail: event.judgement === 'stray' ? '엇박자 · +0' : `+${event.points}` + (event.bonus ? '  /  PERFECT BONUS +1' : '') };
  }
  function updatePose() {
    if (!session) return;
    const mask = [...session.held].reduce((value, lane) => value | (1 << lane), 0);
    if (mask) pose = POSE_MASK[mask] || C.KEYS[lastLane];
  }
  function clearInputs() {
    for (const source of sources) source.clear();
    session?.clearHeld(); pads.forEach(pad => pad.dataset.down = 'false');
  }
  function press(lane, source) {
    if (mode !== 'playing' || currentTime() < 0 || $('rotate-notice').hidden === false || sources[lane].has(source)) return;
    const first = sources[lane].size === 0;
    sources[lane].add(source); pads[lane].dataset.down = 'true'; lastLane = lane;
    if (first) {
      time = currentTime(); session.press(lane, time); updatePose(); updateHUD();
      if (session.finished) endRound();
      // Replace the accepted note with its light effect in the input event itself.
      render(performance.now() / 1000);
    }
  }
  function release(lane, source) {
    sources[lane].delete(source);
    if (!sources[lane].size) { session?.release(lane); pads[lane].dataset.down = 'false'; }
    // Releasing a key holds the last dance pose until a fresh input arrives.
  }
  function setMode(next) {
    mode = next; stage.dataset.mode = mode;
    stage.dataset.phase = String(session?.phase || 1);
    visible('opening-screen', mode === 'opening' || mode === 'revealing');
    visible('title-screen', mode === 'title' || mode === 'revealing');
    $('start-button').disabled = !ready || mode !== 'title';
    visible('pause', mode === 'paused'); visible('result', mode === 'result');
    const game = !!session;
    for (const id of ['hud', 'round-progress', 'beat-indicator', 'key-pads']) visible(id, game);
    if (mode !== 'playing') { visible('countdown', false); visible('phase-announcement', false); }
    visible('clear-cue', mode === 'intermission');
    $('pause-button').disabled = mode !== 'playing' && mode !== 'resuming';
  }
  function startGame(seed = randomSeed(), phase = 1) {
    if (!ready || !$('rotate-notice').hidden) return;
    openingVideo.pause(); clearTimeout(revealTimer);
    visible('title-impact', false);
    stopAudio(); clearInputs(); fx = []; feedback = null; phaseAnnounced = false;
    intermissionElapsed = 0; encoreBeat = -1;
    if (phase === 1) phaseOneScore = 0;
    time = -INTRO_DURATION; baseTime = -INTRO_DURATION; anchor = performance.now(); manual = false; pose = 'normal'; lastHitTime = -99;
    session = new C.Session(seed, onJudge, { phase }); audio.nextBeat = -7;
    setMode('playing'); updateHUD();
    $('game-status').textContent = phase === 2 ? '2페이즈 도전. Special 이상으로 버티세요. 다섯 번째 실수에 종료됩니다.' : 'Ready 세 번, Go 다음 연습 무대가 시작됩니다.';
  }
  function resetDepartedGame() {
    // A restored mobile tab can keep this entire JS session alive. Discard the
    // round before it is cached/hidden, instead of restoring a paused clock.
    if (!session) return;
    stopAudio(); clearInputs(); session = null;
    time = baseTime = -INTRO_DURATION; anchor = lastFrame = performance.now();
    manual = false; resumeRemaining = 0; audio.nextBeat = -7;
    fx = []; feedback = null; phaseAnnounced = false;
    intermissionElapsed = phaseOneScore = titleElapsed = 0; encoreBeat = -1;
    pose = 'normal'; lastLane = 0; lastHitTime = -99;
    openingVideo.pause(); openingVideo.autoplay = false; clearTimeout(revealTimer);
    visible('title-impact', false); $('title-motes').replaceChildren();
    $('opening-screen').classList.remove('is-leaving');
    $('title-screen').classList.add('is-entering');
    quality.reset(); setMode('title');
    $('game-status').textContent = '새 무대가 준비됐어요. 시작하기 버튼이나 R 키로 시작하세요.';
    render(performance.now() / 1000);
  }
  function syncOpeningPlayback() {
    const allowed = mode === 'opening' && !document.hidden && $('rotate-notice').hidden;
    openingVideo.autoplay = allowed;
    if (!allowed) { openingVideo.pause(); return; }
    // A media error can arrive before the deferred game script attaches listeners.
    if (openingVideo.error) {
      setText('opening-message', '영상을 불러오지 못했어요. 다시 재생하거나 시작 화면으로 이동할 수 있어요.');
      visible('opening-recovery', true); return;
    }
    if (!openingVideo.paused || openingPlayPending) return;
    openingPlayPending = true;
    openingVideo.play().then(() => {
      visible('opening-recovery', false);
      if (mode !== 'opening' || document.hidden || !$('rotate-notice').hidden) openingVideo.pause();
    }).catch(error => {
      if (error.name === 'AbortError' || mode !== 'opening') return;
      setText('opening-message', error.name === 'NotAllowedError' ? '영상을 재생하려면 눌러주세요.' : '영상을 재생하지 못했어요. 다시 재생하거나 시작 화면으로 이동할 수 있어요.');
      visible('opening-recovery', true);
    }).finally(() => { openingPlayPending = false; });
  }
  function enterTitle() {
    if (mode !== 'revealing') return;
    clearTimeout(revealTimer); setMode('title');
    $('game-status').textContent = '화락제도 락이다. 시작하기 버튼이나 R 키로 무대에 오르세요.';
  }
  function finishOpening() {
    if (mode !== 'opening') return;
    titleElapsed = 0;
    openingVideo.pause(); openingVideo.autoplay = false;
    visible('opening-recovery', false); setMode('revealing');
    $('title-screen').classList.add('is-entering');
    $('opening-screen').classList.add('is-leaving');
    if (!reducedMotion) {
      // One contact flash ties the video cut and logo punch to the same instant.
      let seed = 0x71c4a9;
      const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
      const motes = document.createDocumentFragment();
      for (let i = 0; i < 56; i++) {
        const mote = document.createElement('i'), angle = random() * Math.PI * 2;
        const distance = Math.min(width * .32, height * .52) * (.35 + random() * .85);
        mote.style.cssText = `--dx:${Math.cos(angle) * distance}px;--dy:${Math.sin(angle) * distance * .62}px;--size:${1.4 + random() * 2.2}px;--life:${.32 + random() * .27}s;--delay:${.06 + random() * .045}s;--glow:${i % 3 ? '#5cfaff' : '#ff76db'}`;
        motes.append(mote);
      }
      $('title-motes').replaceChildren(motes); visible('title-impact', true);
    }
    // Animationend is primary; the timer also handles disabled/interrupted animations.
    revealTimer = setTimeout(enterTitle, reducedMotion ? 500 : 1200);
  }
  function startFromTitle() {
    if (mode !== 'title' || !ready || !$('rotate-notice').hidden) return;
    initAudio(); startGame();
  }
  function pauseGame(reason = '준비되면 다시 무대로 돌아가요.') {
    if (mode !== 'playing' && mode !== 'resuming') return;
    time = currentTime(); session.advance(time); baseTime = time; clearInputs(); stopAudio();
    if (session.finished) { endRound(); return; }
    setText('pause-reason', reason); visible('countdown', false); setMode('paused');
  }
  function resumeGame() {
    if (mode !== 'paused' || !$('rotate-notice').hidden) return;
    resumeRemaining = 1.5; setMode('resuming'); initAudio();
  }
  function endRound() {
    if (mode !== 'playing' && mode !== 'resuming') return;
    time = session.endTime; baseTime = time;
    stopAudio(); clearInputs(); visible('countdown', false);
    if (session.phase === 1) {
      phaseOneScore = session.score; intermissionElapsed = 0; encoreBeat = -1;
      fx = []; feedback = null; setMode('intermission'); advanceEncore(0);
      $('game-status').textContent = '1페이즈 완료! 다 함께 앙코르. 5초 뒤 점수와 도전하기 버튼이 나타납니다.';
    } else finishGame();
    updateHUD();
  }
  function advanceEncore(seconds) {
    intermissionElapsed = Math.min(C.INTERMISSION, intermissionElapsed + seconds);
    const lastBeat = Math.min(9, Math.floor(intermissionElapsed / C.BEAT));
    // Skip expired bursts after a large test/frame jump; each beat emits only once.
    for (let beat = Math.max(encoreBeat + 1, Math.ceil((intermissionElapsed - HIT_LIGHT_DURATION) / C.BEAT)); beat <= lastBeat; beat++) {
      const finale = beat === 8, start = C.DURATION + beat * C.BEAT;
      for (const [index, x] of [.235, .5, .765].entries()) {
        const center = index === 1, effect = hitLight((index + beat) % 4, start, 70000 + beat * 3 + index);
        effect.kind = 'encore'; effect.position = { x, y: .615 };
        effect.sizeFactor = (center ? .6 : .38) * (finale ? 1.35 : 1);
        effect.riseFactor = finale ? .2 : .13;
        effect.motes.length = Math.min(effect.motes.length, finale ? center ? 110 : 68 : center ? 68 : 40);
        fx.push(effect);
      }
      if (!manual && audio.enabled && audio.ctx?.state === 'running' && intermissionElapsed - beat * C.BEAT < .1) {
        tone(audio.ctx.currentTime + .003, finale ? 660 : beat % 2 ? 330 : 440, .07, .16);
      }
    }
    encoreBeat = lastBeat;
    $('clear-cue').dataset.finale = String(intermissionElapsed >= 4);
    setText('clear-message', intermissionElapsed >= 4 ? '다음 무대도, 락이다!' : '다 함께, 앙코르!');
    if (intermissionElapsed >= C.INTERMISSION) finishGame();
  }
  function finishGame() {
    stopAudio(); clearInputs(); visible('countdown', false); setMode('result');
    const survival = session.phase === 2;
    const accuracy = session.accuracy, grade = accuracy >= 95 ? 'S' : accuracy >= 85 ? 'A' : accuracy >= 70 ? 'B' : 'C';
    const newBest = !survival && session.score > best;
    if (newBest) { best = session.score; storeSet('hwarak-best-v2', best); }
    setText('result-title', survival ? '여기까지, 멋진 도전!' : '1페이즈 클리어!');
    setText('result-eyebrow', survival ? 'SURVIVAL RESULT' : 'READY FOR THE NEXT STAGE?');
    setText('result-score-label', survival ? '2페이즈 점수' : '1페이즈 점수');
    visible('result-grade', !survival); visible('survival-result', survival);
    setText('result-survival-time', formatTime(session.endTime || 0, true));
    setText('challenge-button', survival ? '도전 다시하기' : '도전하기');
    setText('challenge-rules', survival ? `5 / 5 실수 · 최종 ${C.speedAt(time, 2).toFixed(2)}배속` : '2.0배속 출발 · 1분마다 +1.0배속 · Special 미만 누적 5회면 탈락');
    visible('combined-result', survival);
    setText('combined-result', `1페이즈 ${phaseOneScore.toLocaleString('ko-KR')}점 · 합산 ${(phaseOneScore + session.score).toLocaleString('ko-KR')}점`);
    setText('result-grade', grade); setText('result-score', session.score.toLocaleString('ko-KR'));
    setText('result-combo', String(session.maxCombo)); setText('result-accuracy', accuracy.toFixed(1) + '%');
    setText('result-breakdown', `기본 ${session.baseScore} + Perfect 보너스 ${session.bonusScore}`);
    setText('result-counts', `PERFECT ${session.counts.perfect} · SPECIAL ${session.counts.special} · GREAT ${session.counts.great} · GOOD ${session.counts.good} · MISS ${session.counts.miss} · 엇박자 ${session.counts.stray}`);
    $('game-status').textContent = survival ? `도전 종료. 버틴 시간 ${formatTime(time, true)}, 2페이즈 점수 ${session.score}.` : `1페이즈 완료. 점수 ${session.score}. 도전하기 또는 처음부터 다시를 선택하세요.`;
  }
  function updateHUD() {
    if (!session) return;
    const elapsed = Math.max(0, time), left = Math.max(0, Math.ceil(C.DURATION - elapsed)), survival = session.phase === 2, practice = !survival && elapsed < C.PRACTICE;
    setText('timer', formatTime(survival ? elapsed : left, survival));
    setText('timer-label', survival ? '버틴 시간' : '남은 시간');
    setText('score-label', survival ? 'PHASE 2 SCORE' : 'TOTAL SCORE');
    setText('score', String(session.score).padStart(4, '0'));
    setText('bonus-score', `+${session.bonusScore}`);
    setText('perfect-streak', session.perfectStreak >= C.BONUS_CHARGE ? `${session.perfectStreak}연속 · 다음 PERFECT +1` : `연속 ${session.perfectStreak} / ${C.BONUS_CHARGE}`);
    $('bonus-panel').classList.toggle('charged', session.perfectStreak >= C.BONUS_CHARGE);
    [...$('streak-dots').children].forEach((dot, index) => dot.classList.toggle('filled', index < session.perfectStreak));
    const encore = mode === 'intermission';
    setText('combo', encore ? '끝까지 해냈다!' : session.combo ? `${session.combo} COMBO!` : elapsed < 2.5 ? '첫 박자를 기다리는 중' : '다음 박자에 다시!');
    setText('phase-label', encore ? 'ENCORE' : survival ? 'SURVIVAL' : practice ? 'WARM UP' : 'PHASE 1'); setText('phase-title', encore ? '앙코르!' : survival ? '2페이즈 도전' : practice ? '연습 무대' : '본무대');
    setText('phase-detail', encore ? '함께 추는 마지막 춤' : survival ? `실수 ${session.failures} / 5 · Special 이상!` : practice ? `단일 노트 · ${Math.max(0, Math.ceil(30 - elapsed))}초 후 본무대` : '두 개씩, 더 빠르게!');
    visible('survival-lives', survival);
    [...$('survival-lives').children].forEach((life, i) => life.classList.toggle('lost', i < session.failures));
    $('survival-lives').setAttribute('aria-label', `실수 ${session.failures}회, ${C.FAILURE_LIMIT - session.failures}회 남음`);
    setText('speed', `SPEED ×${C.speedAt(elapsed, session.phase).toFixed(2)}`);
    $('round-progress-fill').style.width = `${survival ? (1 - session.failures / C.FAILURE_LIMIT) * 100 : clamp(elapsed / C.DURATION) * 100}%`;
    const beat = Math.floor(elapsed / C.BEAT) % 4;
    [...$('beat-indicator').querySelectorAll('i')].forEach((dot, i) => dot.classList.toggle('active', i === beat));
    drawCountdown();
    visible('phase-announcement', !survival && mode === 'playing' && elapsed >= 30 && elapsed < 31.6);
    if (!survival && !phaseAnnounced && elapsed >= 30) { phaseAnnounced = true; $('game-status').textContent = '본무대 시작. DK, FJ, DJ, FK 동시 노트가 함께 나오고 속도가 점점 빨라집니다.'; }
  }
  function update(now, delta) {
    if (mode === 'title' || mode === 'revealing') titleElapsed += delta;
    if (mode === 'intermission' && !manual) {
      advanceEncore(delta);
    }
    if (mode === 'resuming') {
      resumeRemaining -= delta;
      if (resumeRemaining <= 0) { baseTime = time; anchor = now; audio.nextBeat = Math.ceil(time / C.BEAT); setMode('playing'); }
    }
    if (mode === 'playing') { time = currentTime(); session.advance(time); if (session.finished) endRound(); else scheduleBeat(); }
    updateHUD();
  }
  function frame(now) {
    const deltaMs = now - lastFrame; lastFrame = now;
    const active = !document.hidden && $('rotate-notice').hidden;
    if (quality.observe(deltaMs, active && mode === 'playing' && !manual && time >= 0)) resize();
    if (active) {
      update(now, Math.min(.1, deltaMs / 1000));
      // The opaque video covers the stage; let its decoder have the frame budget.
      if (mode !== 'opening') render(now / 1000);
    }
    requestAnimationFrame(frame);
  }
  function resize() {
    const bounds = stage.getBoundingClientRect(); width = bounds.width; height = bounds.height;
    const ratio = quality.ratio(width, height, window.devicePixelRatio);
    const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight || renderRatio !== ratio) {
      renderRatio = ratio; canvas.width = pixelWidth; canvas.height = pixelHeight;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); staticLayers.clear(); quality.reset();
    }
    pads.forEach((pad, lane) => {
      const p = target(lane), w = width * .23, top = p.y - Math.max(16, height * .032);
      Object.assign(pad.style, { left: `${p.x - w / 2}px`, top: `${top}px`, width: `${w}px`, height: `${height - top}px`, paddingTop: `${p.y - top}px`, '--lane-color': COLORS[lane] });
    });
    render(performance.now() / 1000);
  }
  function checkOrientation() {
    const ua = navigator.userAgent;
    const tablet = /iPad|Tablet|SM-X|SM-T/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    phone = !tablet && (/iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua) || (!!navigator.userAgentData?.mobile) || (matchMedia('(pointer:coarse)').matches && Math.min(screen.width, screen.height) < 600));
    document.body.dataset.phone = String(phone);
    const blocked = phone && window.innerHeight > window.innerWidth;
    visible('rotate-notice', blocked);
    if (blocked) pauseGame('휴대폰을 가로로 돌린 뒤 계속할 수 있어요.');
    syncOpeningPlayback();
    requestAnimationFrame(resize);
  }
  for (const [lane, pad] of pads.entries()) {
    pad.addEventListener('pointerdown', event => { if (event.pointerType === 'mouse' && event.button !== 0) return; event.preventDefault(); pad.setPointerCapture(event.pointerId); press(lane, `p${event.pointerId}`); });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(name, event => release(lane, `p${event.pointerId}`));
    pad.addEventListener('click', event => { if (event.detail === 0) { press(lane, 'assistive'); setTimeout(() => release(lane, 'assistive'), 80); } });
  }
  window.addEventListener('keydown', event => {
    const lane = CODE_TO_LANE[event.code];
    if (lane != null) { event.preventDefault(); if (!event.repeat) press(lane, event.code); return; }
    if (event.repeat) return;
    if (event.code === 'KeyR' && mode === 'title') { event.preventDefault(); startFromTitle(); return; }
    if (event.code === 'Escape') { event.preventDefault(); if (mode === 'paused') resumeGame(); else pauseGame(); }
    if (event.code === 'Enter' && mode === 'result' && event.target.tagName !== 'BUTTON') startGame();
  });
  window.addEventListener('keyup', event => { const lane = CODE_TO_LANE[event.code]; if (lane != null) release(lane, event.code); });
  window.addEventListener('blur', () => pauseGame('화면을 벗어나 잠시 멈췄어요. 준비되면 이어서 플레이하세요.'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (phone) resetDepartedGame();
      else pauseGame('화면을 벗어나 잠시 멈췄어요.');
    }
    syncOpeningPlayback();
  });
  // pagehide covers navigation/back-forward cache; visibilitychange also covers
  // mobile app switching, where pagehide is not guaranteed to run.
  window.addEventListener('pagehide', resetDepartedGame);
  window.addEventListener('pageshow', event => {
    if (event.persisted) resetDepartedGame();
    lastFrame = performance.now(); syncOpeningPlayback();
  });
  window.addEventListener('resize', checkOrientation); document.addEventListener('fullscreenchange', resize);
  $('start-button').addEventListener('click', startFromTitle);
  openingVideo.addEventListener('ended', finishOpening);
  openingVideo.addEventListener('error', () => {
    if (mode !== 'opening') return;
    setText('opening-message', '영상을 불러오지 못했어요. 다시 재생하거나 시작 화면으로 이동할 수 있어요.');
    visible('opening-recovery', true);
  });
  $('opening-screen').addEventListener('animationend', event => { if (event.target === $('opening-screen')) enterTitle(); });
  $('title-impact').addEventListener('animationend', event => { if (event.target === $('title-impact')) visible('title-impact', false); });
  $('opening-skip').addEventListener('click', finishOpening);
  $('opening-continue').addEventListener('click', finishOpening);
  $('opening-play').addEventListener('click', () => {
    visible('opening-recovery', false);
    if (openingVideo.error) openingVideo.load();
    syncOpeningPlayback();
  });
  $('opening-sound').addEventListener('click', () => {
    openingVideo.muted = !openingVideo.muted;
    $('opening-sound').setAttribute('aria-pressed', String(!openingVideo.muted));
    setText('opening-sound', openingVideo.muted ? '♫ 소리 켜기' : '♫ 소리 끄기');
    syncOpeningPlayback();
  });
  $('retry-button').addEventListener('click', () => startGame());
  $('challenge-button').addEventListener('click', () => { if (mode === 'result') { initAudio(); startGame(randomSeed(), 2); } });
  $('restart-pause').addEventListener('click', () => startGame());
  $('pause-button').addEventListener('click', () => pauseGame()); $('resume-button').addEventListener('click', resumeGame);
  $('sound-toggle').addEventListener('click', () => {
    if (audio.enabled && audio.ctx?.state !== 'running') { initAudio(); return; }
    audio.enabled = !audio.enabled; storeSet('hwarak-sound', audio.enabled); stopAudio();
    if (audio.enabled) { initAudio(); audio.nextBeat = Math.ceil(currentTime() / C.BEAT); } updateSoundUI();
  });
  const unlockAudio = event => {
    if (mode !== 'playing' && mode !== 'title' && mode !== 'resuming') return;
    if (event.target.closest?.('#sound-toggle')) return;
    if (audio.enabled && audio.ctx?.state !== 'running') initAudio();
  };
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
  document.addEventListener('keydown', unlockAudio);
  $('fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else if (stage.requestFullscreen) await stage.requestFullscreen(); } catch {} });

  // Readable state and deterministic time stepping for repeatable gameplay verification.
  window.render_game_to_text = () => JSON.stringify({
    mode, ready, time: +time.toFixed(3), roundPhase: session?.phase || 1, phase: session?.phase === 2 ? 'survival' : time < 30 ? 'practice' : 'challenge', phone, rotateRequired: !$('rotate-notice').hidden,
    failures: session?.failures || 0, failureLimit: C.FAILURE_LIMIT, survivalTime: session?.phase === 2 ? +Math.max(0, time).toFixed(3) : null,
    phaseOneScore, combinedScore: session?.phase === 2 ? phaseOneScore + session.score : session?.score || 0,
    intermissionRemaining: mode === 'intermission' ? +(C.INTERMISSION - intermissionElapsed).toFixed(3) : 0,
    rendering: { quality: quality.profile.name, ratio: +renderRatio.toFixed(2), motesPerHit: quality.profile.motes, automaticChanges: quality.changes, cachedLayers: staticLayers.size },
    score: session?.score || 0, combo: session?.combo || 0, maxCombo: session?.maxCombo || 0, accuracy: +(session?.accuracy ?? 100).toFixed(2),
    baseScore: session?.baseScore || 0, bonusScore: session?.bonusScore || 0, perfectStreak: session?.perfectStreak || 0,
    beatMotion: beatMotion(Math.max(0, time)), backgroundLoaded: !!textures.background,
    opening: mode === 'playing' ? openingCue(time) : null,
    introVideo: { time: +openingVideo.currentTime.toFixed(2), duration: Number.isFinite(openingVideo.duration) ? openingVideo.duration : null,
      paused: openingVideo.paused, muted: openingVideo.muted, ended: openingVideo.ended, error: openingVideo.error?.code || null },
    title: { visible: !$('title-screen').hidden, logoLoaded: titleLogoLoaded, canStart: mode === 'title' && ready && $('rotate-notice').hidden },
    hero: heroLayout(), skeletonsLoaded: Object.keys(skeletonTextures).length,
    sideDancers: sideDancerLayout(Math.max(0, time)).map(d => ({ kind: d.kind, x: +d.x.toFixed(1), feet: +d.feet.toFixed(1), figureHeight: +d.figureHeight.toFixed(1), opacity: +d.opacity.toFixed(2), pose: d.pose })),
    counts: session?.counts || {}, pose: displayPose(), held: session ? [...session.held].map(l => C.KEYS[l]) : [], seed: session?.seed,
    choreography: { title: mode === 'title' || mode === 'revealing', titleTime: +titleElapsed.toFixed(3),
      titleHero: titleHeroLayout(), encore: mode === 'intermission', encoreTime: +intermissionElapsed.toFixed(3), beat: encoreBeat,
      bursts: fx.filter(f => f.kind === 'encore' && C.DURATION + intermissionElapsed - f.start < HIT_LIGHT_DURATION).length },
    speed: +C.speedAt(Math.max(0, time), session?.phase || 1).toFixed(3),
    notes: session?.visible(time).map(n => ({ id: n.id, keys: n.lanes.map(l => C.KEYS[l]), hit: n.hit, spawn: +n.spawn.toFixed(3), travel: +n.travel.toFixed(3), partial: Object.keys(n.inputs).map(l => C.KEYS[l]) })) || [],
    next: session?.chart.filter(n => !n.resolved && n.hit > time).slice(0, 4).map(n => ({ id: n.id, keys: n.lanes.map(l => C.KEYS[l]), hit: n.hit })) || [],
    coordinates: 'Canvas origin top-left. Notes emerge at center x, 59% height near the front-stage otter; targets at 84.5% height.'
  });
  window.advanceTime = ms => {
    if (!Number.isFinite(ms) || ms < 0) return;
    if (mode === 'title' || mode === 'revealing') { titleElapsed += ms / 1000; render(performance.now() / 1000); return; }
    if (!session) return;
    if (!manual) { time = currentTime(); manual = true; stopAudio(); }
    if (mode === 'paused' || mode === 'result') return;
    let seconds = ms / 1000;
    if (mode === 'resuming') {
      const step = Math.min(resumeRemaining, seconds); resumeRemaining -= step; seconds -= step;
      if (resumeRemaining <= 0) setMode('playing');
    }
    if (mode === 'intermission') {
      advanceEncore(seconds);
    } else if (mode === 'playing') {
      time += seconds; session.advance(time);
      if (session.finished) {
        const leftover = Math.max(0, time - session.endTime); endRound();
        if (mode === 'intermission') advanceEncore(leftover);
      }
    }
    updateHUD(); render(performance.now() / 1000);
  };
  // A seeded start is exposed only for local/browser test runs; ordinary starts use a fresh random seed.
  window.HwarakTest = {
    start: (seed, phase = 1) => startGame(seed, phase),
    time: () => time,
    chart: () => session?.chart.map(n => ({ id: n.id, keys: n.lanes.map(l => C.KEYS[l]), hit: n.hit, spawn: n.spawn, travel: n.travel })) || [],
    renderQuality: name => {
      const level = window.HwarakQuality.profiles.findIndex(profile => profile.name === name);
      if (level < 0) throw new Error('Unknown render quality');
      quality.level = level; quality.reset(); resize();
    }
  };

  updateSoundUI();
  checkOrientation(); new ResizeObserver(resize).observe(stage);
  const titleImageReady = $('title-logo').decode().then(() => { titleLogoLoaded = true; }).catch(() => {
    visible('title-logo', false); visible('title-fallback', true);
  });
  Promise.all([...Object.keys(POSES).map(async name => {
    const image = new Image(); image.src = assets[`character/otter-${name}.png`];
    await image.decode(); otterMaterials[name] = makeOtterMaterial(image);
  }), ...Object.keys(POSES).map(async name => {
    const image = new Image(); image.src = assets[`character/skeleton-${name}.png`];
    await image.decode(); skeletonTextures[name] = image;
  }), titleImageReady, (async () => { const background = new Image(); background.src = assets['assets/neon-festival.png']; await background.decode(); textures.background = background; staticLayers.delete('background'); })()]).then(() => {
    ready = true; setText('start-label', '시작하기'); $('start-button').disabled = mode !== 'title';
  }).catch(error => { visible('load-error', true); setText('load-error', '무대 이미지를 불러오지 못했어요. character와 assets 폴더가 게임과 함께 있는지 확인해주세요.'); console.error('Stage loading failed:', error); });
  requestAnimationFrame(frame);
})();
