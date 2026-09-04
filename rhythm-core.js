(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HwarakCore = api;
})(globalThis, function () {
  'use strict';
  const DURATION = 120;
  const PRACTICE = 30;
  const BEAT = 0.5;
  const PERFECT = 0.045;
  const SPECIAL = 0.080;
  const GREAT = 0.120;
  const GOOD = 0.16;
  const POINTS = Object.freeze({ perfect: 5, special: 4, great: 3, good: 2, miss: 1 });
  const WINDOWS = [['perfect', PERFECT], ['special', SPECIAL], ['great', GREAT], ['good', GOOD]];
  const BONUS_CHARGE = 5;
  const CHORD_GAP = 0.10;
  const PAIRS = [[0, 1], [2, 3], [0, 2], [1, 3]];
  const KEYS = ['D', 'F', 'J', 'K'];
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

  function random(seed) {
    let state = seed >>> 0;
    return () => {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(items, rng) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function travelAt(time) {
    return 2.4 - 1.5 * Math.pow(clamp((time - PRACTICE) / (DURATION - PRACTICE)), 0.85);
  }
  function createChart(seed) {
    const rng = random(seed);
    let singles = [], pairs = [], id = 0, challengeCount = 0;
    const chart = [];
    const nextSingle = () => {
      if (!singles.length) singles = shuffle([0, 1, 2, 3], rng);
      return [singles.pop()];
    };
    for (let hit = 2.5; hit < DURATION; hit += hit < 31.5 ? 1 : BEAT) {
      const travel = travelAt(hit);
      const spawn = hit - travel;
      let lanes = nextSingle();
      if (spawn >= PRACTICE) {
        const chance = 0.24 + 0.30 * clamp((hit - PRACTICE) / 90);
        if (challengeCount++ === 0 || rng() < chance) {
          if (!pairs.length) pairs = shuffle(PAIRS, rng);
          lanes = pairs.pop().slice();
        }
      }
      chart.push({ id: id++, hit, spawn, travel, lanes, resolved: false, inputs: {} });
    }
    return chart;
  }
  class Session {
    constructor(seed, onJudge = () => {}) {
      this.seed = seed >>> 0;
      this.chart = createChart(this.seed);
      this.onJudge = onJudge;
      this.time = -3;
      this.held = new Set();
      this.score = 0;
      this.baseScore = 0;
      this.bonusScore = 0;
      this.perfectStreak = 0;
      this.maxPerfectStreak = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.counts = { perfect: 0, special: 0, great: 0, good: 0, miss: 0, stray: 0 };
      this.finished = false;
    }
    advance(time) {
      this.time = time;
      for (const note of this.chart) {
        if (!note.resolved && time > note.hit + GOOD + 1e-9) this.resolve(note, 'miss', null);
      }
      if (time >= DURATION) this.finished = true;
    }
    resolve(note, judgement, delta) {
      if (note.resolved) return;
      note.resolved = true;
      note.judgement = judgement;
      // One displayed judgement is one scoring/streak event, including a two-key chord.
      this.counts[judgement]++;
      const points = POINTS[judgement];
      this.baseScore += points;
      let bonus = 0;
      if (judgement === 'perfect') {
        this.perfectStreak++;
        this.maxPerfectStreak = Math.max(this.maxPerfectStreak, this.perfectStreak);
        if (this.perfectStreak > BONUS_CHARGE) bonus = 1;
      } else this.perfectStreak = 0;
      this.bonusScore += bonus;
      this.score = this.baseScore + this.bonusScore;
      if (judgement === 'miss') this.combo = 0;
      else {
        this.combo++;
        this.maxCombo = Math.max(this.combo, this.maxCombo);
      }
      this.onJudge({ judgement, lanes: note.lanes, delta, noteId: note.id, points, bonus });
    }
    press(lane, time) {
      if (this.held.has(lane)) return;
      this.held.add(lane);
      if (time < 0 || this.finished) return;
      this.advance(time);
      const note = this.chart.filter(n => !n.resolved && n.lanes.includes(lane) && Math.abs(n.hit - time) <= GOOD + 1e-9)
        .sort((a, b) => Math.abs(a.hit - time) - Math.abs(b.hit - time))[0];
      if (!note) {
        this.counts.stray++;
        this.combo = 0;
        this.perfectStreak = 0;
        // Empty taps cannot manufacture MISS points; only chart events award points.
        this.onJudge({ judgement: 'stray', lanes: [lane], delta: null, points: 0, bonus: 0 });
        return;
      }
      note.inputs[lane] = { time, delta: time - note.hit };
      if (!note.lanes.every(key => note.inputs[key] && this.held.has(key))) return;
      const inputs = note.lanes.map(key => note.inputs[key]);
      if (Math.max(...inputs.map(x => x.time)) - Math.min(...inputs.map(x => x.time)) > CHORD_GAP) return;
      const worst = inputs.reduce((a, b) => Math.abs(a.delta) > Math.abs(b.delta) ? a : b);
      this.resolve(note, WINDOWS.find(([, limit]) => Math.abs(worst.delta) <= limit + 1e-9)[0], worst.delta);
    }
    release(lane) {
      this.held.delete(lane);
      for (const note of this.chart) if (!note.resolved) delete note.inputs[lane];
    }
    clearHeld() {
      this.held.clear();
      for (const note of this.chart) if (!note.resolved) note.inputs = {};
    }
    get accuracy() {
      const { perfect, special, great, good, miss, stray } = this.counts;
      const total = perfect + special + great + good + miss + stray;
      return total ? 100 * (perfect + special * .8 + great * .6 + good * .4) / total : 100;
    }
    visible(time = this.time) {
      return this.chart.filter(n => !n.resolved && time >= n.spawn && time <= n.hit + GOOD);
    }
  }
  return { DURATION, PRACTICE, BEAT, PERFECT, SPECIAL, GREAT, GOOD, POINTS, BONUS_CHARGE, CHORD_GAP, PAIRS, KEYS, travelAt, createChart, Session };
});
