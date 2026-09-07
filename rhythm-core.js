(function (root, factory) {
  const track = typeof module === 'object' && module.exports ? require('./music-track.js') : root.HwarakTrack;
  const api = factory(track);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HwarakCore = api;
})(globalThis, function (track) {
  'use strict';
  const DURATION = 120;
  const PRACTICE = 15;
  const BEAT = 60 / track.bpm;
  const BEAT_OFFSET = track.beatOffset;
  const FIRST_HIT = BEAT_OFFSET + track.firstBeat * BEAT;
  const PERFECT = 0.080;
  const SPECIAL = 0.130;
  const GREAT = 0.180;
  const GOOD = 0.240;
  const POINTS = Object.freeze({ perfect: 5, special: 4, great: 3, good: 2, miss: 0 });
  const STRAY_PENALTY = 3;
  const WINDOWS = [['perfect', PERFECT], ['special', SPECIAL], ['great', GREAT], ['good', GOOD]];
  const BONUS_CHARGE = 5;
  const CHORD_GAP = 0.18;
  const FAILURE_LIMIT = 5;
  const INTERMISSION = 5;
  const PAIRS = [[0, 3], [1, 2], [0, 2], [1, 3]];
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
  function speedAt(time, phase = 1) {
    return phase === 2 ? 1.6 + Math.max(0, time) / 90 : 1 + .6 * clamp((time - PRACTICE) / (DURATION - PRACTICE));
  }
  function travelAt(time, phase = 1) { return 2.4 / speedAt(time, phase); }
  function noteGenerator(seed, phase) {
    const rng = random(seed);
    let singles = [], pairs = [], id = 0, challengeCount = 0, denseIndex = 0, beatIndex = track.firstBeat, previous = null;
    const nextSingle = excluded => {
      if (!singles.some(lane => !excluded.includes(lane))) singles = shuffle([0, 1, 2, 3], rng);
      const index = singles.findLastIndex(lane => !excluded.includes(lane));
      return singles.splice(index, 1);
    };
    return () => {
      const hit = +(BEAT_OFFSET + beatIndex * BEAT).toFixed(6);
      const travel = travelAt(hit, phase);
      const spawn = hit - travel;
      // Half-beat windows overlap. Alternate hands/lanes so a late
      // input for one note can never be assigned to its early neighbour.
      const excluded = previous && hit - previous.hit < BEAT - 1e-6 ? previous.lanes : [];
      let lanes = nextSingle(excluded);
      if (phase === 2 || spawn >= PRACTICE) {
        const chance = phase === 2 ? .42 : .22 + .20 * clamp((hit - PRACTICE) / (DURATION - PRACTICE));
        if (challengeCount++ === 0 || rng() < chance) {
          const compatible = pair => pair.every(lane => !excluded.includes(lane));
          if (!pairs.some(compatible)) pairs = shuffle(PAIRS.filter(compatible), rng);
          lanes = pairs.splice(pairs.findLastIndex(compatible), 1)[0].slice();
        }
      }
      const note = { id: id++, hit, spawn, travel, lanes, resolved: false, inputs: {}, attempts: {} };
      // One full beat, then two half beats: three notes every two beats.
      // This keeps musical accents and a breathing gap instead of constant eighths.
      beatIndex += phase === 2 || spawn >= PRACTICE ? [1, .5, .5][denseIndex++ % 3] : 1;
      previous = note;
      return note;
    };
  }
  function createChart(seed) {
    const next = noteGenerator(seed, 1), chart = [];
    for (let note = next(); note.hit + GOOD < DURATION; note = next()) chart.push(note);
    return chart;
  }
  class Session {
    constructor(seed, onJudge = () => {}, options = {}) {
      this.seed = seed >>> 0;
      this.phase = options.phase === 2 ? 2 : 1;
      this.nextNote = this.phase === 2 ? noteGenerator(this.seed, 2) : null;
      this.chart = this.phase === 2 ? [] : createChart(this.seed);
      this.onJudge = onJudge;
      this.time = -3;
      this.held = new Set();
      this.score = 0;
      this.baseScore = 0;
      this.bonusScore = 0;
      this.penaltyScore = 0;
      this.perfectStreak = 0;
      this.maxPerfectStreak = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.counts = { perfect: 0, special: 0, great: 0, good: 0, miss: 0, stray: 0 };
      this.finished = false;
      this.failures = 0;
      this.endTime = null;
      this.endReason = null;
      if (this.phase === 2) this.fillAhead(0);
    }
    fillAhead(time) {
      // A rolling buffer keeps an open-ended round small even after many minutes.
      while (!this.chart.length || this.chart.at(-1).hit < time + 3) this.chart.push(this.nextNote());
    }
    advance(time) {
      if (this.finished) return;
      for (const note of this.chart) if (!note.resolved) {
        for (const lane of Object.keys(note.inputs)) {
          if (time - note.inputs[lane].time > CHORD_GAP + 1e-9) delete note.inputs[lane];
        }
      }
      if (this.phase === 2) {
        // Resolve overdue notes in chronological order. A long frame or test jump
        // ends exactly at the fifth failure, never at the later polling time.
        while (!this.finished) {
          let note = this.chart.find(n => !n.resolved);
          if (!note) { note = this.nextNote(); this.chart.push(note); }
          if (time <= note.hit + GOOD + 1e-9) break;
          this.time = note.hit + GOOD;
          this.resolve(note, 'miss', null);
        }
        if (!this.finished) {
          this.time = time; this.fillAhead(time);
          this.chart = this.chart.filter(n => !n.resolved || n.hit >= time - 2);
        }
        return;
      }
      this.time = time;
      for (const note of this.chart) {
        if (!note.resolved && time > note.hit + GOOD + 1e-9) this.resolve(note, 'miss', null);
      }
      if (time + 1e-9 >= DURATION) { this.finished = true; this.time = this.endTime = DURATION; this.endReason = 'clear'; }
    }
    resolve(note, judgement, delta) {
      if (note.resolved || this.finished) return;
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
      this.updateScore();
      if (judgement === 'miss') this.combo = 0;
      else {
        this.combo++;
        this.maxCombo = Math.max(this.combo, this.maxCombo);
      }
      if (judgement === 'miss') this.fail();
      this.onJudge({ judgement, lanes: note.lanes, delta, noteId: note.id, points, bonus });
    }
    updateScore() {
      // Keep every deduction even while the displayed score is clamped at zero.
      this.score = Math.max(0, this.baseScore + this.bonusScore - this.penaltyScore);
    }
    fail() {
      if (this.phase !== 2) return;
      this.failures++;
      if (this.failures >= FAILURE_LIMIT) {
        this.finished = true; this.endTime = Math.max(0, this.time); this.endReason = 'eliminated';
      }
    }
    stray(lane) {
      // Ready/Go and the approach to the first timing window are free practice.
      // Keep the last note's full window active, including extra keys after a hit.
      if (this.time < FIRST_HIT - GOOD - 1e-9 ||
          (this.phase === 1 && this.time > this.chart.at(-1).hit + GOOD + 1e-9)) return;
      this.counts.stray++;
      this.penaltyScore += STRAY_PENALTY;
      this.combo = 0; this.perfectStreak = 0;
      this.updateScore(); this.fail();
      this.onJudge({ judgement: 'stray', lanes: [lane], delta: null, noteId: null, points: -STRAY_PENALTY, bonus: 0 });
    }
    press(lane, time) {
      if (this.finished || this.held.has(lane)) return;
      this.held.add(lane);
      if (time < 0 || this.finished) return;
      this.advance(time);
      if (this.finished) return;
      const note = this.chart.filter(n => !n.resolved && n.lanes.includes(lane) && Math.abs(n.hit - time) <= GOOD + 1e-9)
        .sort((a, b) => Math.abs(a.hit - time) - Math.abs(b.hit - time))[0];
      if (!note || note.attempts[lane]) { this.stray(lane); return; }
      note.inputs[lane] = note.attempts[lane] = { time, delta: time - note.hit };
      // A quick tap remains valid after release so a natural two-finger roll
      // is accepted. The FIRST attempt is immutable, even after its chord gap
      // expires: re-tapping cannot replace an early attempt with a better one.
      if (!note.lanes.every(key => note.attempts[key])) return;
      const inputs = note.lanes.map(key => note.attempts[key]);
      if (Math.max(...inputs.map(x => x.time)) - Math.min(...inputs.map(x => x.time)) > CHORD_GAP + 1e-9) return;
      const worst = inputs.reduce((a, b) => Math.abs(a.delta) > Math.abs(b.delta) ? a : b);
      this.resolve(note, WINDOWS.find(([, limit]) => Math.abs(worst.delta) <= limit + 1e-9)[0], worst.delta);
    }
    release(lane) {
      this.held.delete(lane);
    }
    clearHeld() {
      this.held.clear();
    }
    get accuracy() {
      const { perfect, special, great, good, miss, stray } = this.counts;
      const total = perfect + special + great + good + miss + stray;
      return total ? 100 * (perfect + special * .8 + great * .6 + good * .4) / total : 100;
    }
    visible(time = this.time) {
      if (this.finished) return [];
      return this.chart.filter(n => !n.resolved && time >= n.spawn && time <= n.hit + GOOD);
    }
  }
  return { DURATION, PRACTICE, BEAT, BEAT_OFFSET, FIRST_HIT, CHART_VERSION: track.version, PERFECT, SPECIAL, GREAT, GOOD, POINTS, STRAY_PENALTY, BONUS_CHARGE, CHORD_GAP, FAILURE_LIMIT, INTERMISSION, PAIRS, KEYS, speedAt, travelAt, createChart, Session };
});
