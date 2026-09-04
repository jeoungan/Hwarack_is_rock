const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../rhythm-core.js');

test('100 random charts preserve the practice boundary, beat grid, supported chords and increasing speed', () => {
  const valid = new Set(C.PAIRS.map(pair => pair.join(',')));
  for (let seed = 1; seed <= 100; seed++) {
    const chart = C.createChart(seed);
    assert.deepEqual(chart.slice(0, 4).map(note => note.lanes[0]).sort(), [0, 1, 2, 3]);
    assert.ok(chart.some(note => note.lanes.length === 2));
    assert.ok(chart.every(note => note.spawn >= 0 && note.hit < 120 && Math.abs((note.hit - C.BEAT_OFFSET) / C.BEAT - Math.round((note.hit - C.BEAT_OFFSET) / C.BEAT)) < 1e-8));
    assert.ok(chart.filter(note => note.spawn < 15).every(note => note.lanes.length === 1));
    assert.ok(chart.every(note => note.lanes.length === 1 || valid.has(note.lanes.join(','))));
    for (let i = 1; i < chart.length; i++) {
      assert.ok(chart[i].hit > chart[i - 1].hit);
      assert.ok(chart[i].travel <= chart[i - 1].travel);
    }
    assert.ok(chart.at(-1).travel >= 1.2 && chart.at(-1).travel < 1.21);
  }
});
test('same seed reproduces a chart; a new seed changes it', () => {
  assert.deepEqual(C.createChart(7), C.createChart(7));
  assert.notDeepEqual(C.createChart(7).map(n => n.lanes), C.createChart(8).map(n => n.lanes));
});
test('five timing grades have inclusive boundaries, symmetric early/late windows and 5/4/3/2/1 points', () => {
  for (const sign of [-1, 1]) for (const [delta, grade] of [[0, 'perfect'], [.045, 'perfect'], [.0451, 'special'], [.08, 'special'], [.0801, 'great'], [.12, 'great'], [.1201, 'good'], [.16, 'good']]) {
    const s = new C.Session(5), n = s.chart[0];
    s.press(n.lanes[0], n.hit + sign * delta);
    assert.equal(n.judgement, grade, `${sign * delta}s`);
    assert.equal(s.score, C.POINTS[grade]);
  }
  const s = new C.Session(5); s.advance(s.chart[0].hit + .1601);
  assert.equal(s.chart[0].judgement, 'miss'); assert.equal(s.score, 1);
  s.advance(s.chart[0].hit + .3); assert.equal(s.score, 1, 'a miss is scored once');
});
test('a chord needs overlapping presses and counts as one displayed judgement and streak event', () => {
  const s = new C.Session(9), chord = s.chart.find(n => n.lanes.length === 2);
  s.advance(chord.hit - .05);
  const before = s.score;
  s.press(chord.lanes[0], chord.hit - .04);
  assert.equal(chord.resolved, false);
  s.press(chord.lanes[1], chord.hit + .02);
  assert.equal(chord.judgement, 'perfect'); assert.equal(s.score, before + 5); assert.equal(s.combo, 1);
  assert.equal(s.counts.perfect, 1); assert.equal(s.perfectStreak, 1);
});
test('separate taps and widely separated chord presses do not count as simultaneous', () => {
  for (const separated of [true, false]) {
    const s = new C.Session(9), chord = s.chart.find(n => n.lanes.length === 2);
    s.press(chord.lanes[0], chord.hit - .08);
    if (separated) s.release(chord.lanes[0]);
    s.press(chord.lanes[1], chord.hit + .05);
    s.advance(chord.hit + .17);
    assert.equal(chord.judgement, 'miss'); assert.equal(s.score, s.counts.miss);
  }
});
test('held/repeated input cannot clear later notes; only missed notes break a combo', () => {
  const s = new C.Session(15), first = s.chart[0];
  s.press(first.lanes[0], first.hit);
  const later = s.chart.find(n => n.id > first.id && n.lanes.includes(first.lanes[0]));
  s.press(first.lanes[0], later.hit); s.advance(later.hit + .17);
  assert.equal(later.judgement, 'miss');
  s.clearHeld(); s.press(0, 119.99);
  assert.equal(s.combo, 0); assert.equal(s.counts.stray, 0);
});
test('all misses still complete the two-minute round', () => {
  const s = new C.Session(5); s.advance(120);
  assert.equal(s.finished, true); assert.equal(s.score, s.chart.length);
  assert.equal(s.counts.miss, s.chart.length);
  assert.equal(s.accuracy, 0);
});

function hit(s, n, offset = 0) {
  for (const lane of n.lanes) s.press(lane, n.hit + offset);
  for (const lane of n.lanes) s.release(lane);
}
test('first five Perfects charge, the sixth onward earns +1, total equals base plus bonus', () => {
  const s = new C.Session(42);
  for (let i = 0; i < 8; i++) {
    hit(s, s.chart[i]);
    assert.equal(s.perfectStreak, i + 1);
    assert.equal(s.bonusScore, Math.max(0, i - 4));
    assert.equal(s.baseScore, (i + 1) * 5);
    assert.equal(s.score, s.baseScore + s.bonusScore);
  }
});
test('every non-Perfect resets charge but preserves earned bonus; five new Perfects are needed', () => {
  for (const grade of ['special', 'great', 'good', 'miss']) {
    const s = new C.Session(7);
    for (const n of s.chart.slice(0, 6)) hit(s, n);
    assert.equal(s.bonusScore, 1);
    const breaker = s.chart[6];
    if (grade === 'miss') s.advance(breaker.hit + .17);
    else hit(s, breaker, { special: .06, great: .10, good: .14 }[grade]);
    assert.equal(s.perfectStreak, 0, grade);
    assert.equal(s.bonusScore, 1, grade);
    const restart = 7;
    for (const n of s.chart.slice(restart, restart + 5)) hit(s, n);
    assert.equal(s.perfectStreak, 5); assert.equal(s.bonusScore, 1);
    hit(s, s.chart[restart + 5]); assert.equal(s.bonusScore, 2);
  }
});
test('empty taps and repeated resolution cannot farm points', () => {
  const s = new C.Session(12), n = s.chart[0]; hit(s, n);
  s.resolve(n, 'perfect', 0); assert.equal(s.score, 5);
  for (let i = 0; i < 40; i++) { s.press(0, n.hit + .3); s.release(0); }
  assert.equal(s.score, 5); assert.equal(s.perfectStreak, 1); assert.equal(s.counts.stray, 0); assert.equal(s.accuracy, 100);
});
test('a fully Perfect round has exactly chart.length - 5 bonus points including chords', () => {
  const s = new C.Session(42); for (const n of s.chart) hit(s, n); s.advance(120);
  assert.equal(s.counts.perfect, s.chart.length); assert.equal(s.bonusScore, s.chart.length - 5);
  assert.equal(s.score, s.chart.length * 6 - 5); assert.equal(s.accuracy, 100);
});

test('all chords cross the two hands and phase-one speed reaches exactly 2x at 120 seconds', () => {
  assert.deepEqual(C.PAIRS, [[0, 3], [1, 2], [0, 2], [1, 3]]);
  for (const [time, speed] of [[0, 1], [15, 1], [67.5, 1.5], [120, 2], [200, 2]]) assert.equal(C.speedAt(time), speed);
  for (const [time, speed] of [[0, 2], [30, 2.5], [60, 3], [120, 4], [600, 12]]) assert.equal(C.speedAt(time, 2), speed);
});

test('survival counts Great/Good/Miss cumulatively; Perfect/Special do not restore lives', () => {
  const s = new C.Session(42, () => {}, { phase: 2 });
  const offsets = [.10, .06, .14, 0, .17, .08, .10, .14];
  let failures = 0;
  for (const offset of offsets) {
    const n = s.chart.find(n => !n.resolved);
    if (offset > C.GOOD) s.advance(n.hit + offset); else hit(s, n, offset);
    if (offset > C.SPECIAL) failures++;
    assert.equal(s.failures, failures);
    assert.equal(s.finished, failures === 5);
  }
  assert.equal(s.endReason, 'eliminated');
  assert.equal(s.counts.great, 2); assert.equal(s.counts.good, 2); assert.equal(s.counts.miss, 1);
  const frozen = { score: s.score, endTime: s.endTime, counts: { ...s.counts } };
  s.advance(600); s.press(0, 601); s.resolve(s.chart.find(n => !n.resolved), 'perfect', 0);
  assert.deepEqual({ score: s.score, endTime: s.endTime, counts: s.counts }, frozen);
  assert.deepEqual(s.visible(), []);
});

test('a failed two-key chord consumes one life; late input cannot score after the fifth missed note', () => {
  const s = new C.Session(3, () => {}, { phase: 2 });
  const chord = s.chart[0]; assert.equal(chord.lanes.length, 2);
  s.press(chord.lanes[0], chord.hit); s.release(chord.lanes[0]); s.advance(chord.hit + .17);
  assert.equal(s.failures, 1); assert.equal(s.score, 1);
  s.press(0, 100);
  assert.equal(s.failures, 5); assert.equal(s.score, 5); assert.equal(s.counts.stray, 0);
  assert.ok(Math.abs(s.endTime - (C.FIRST_HIT + 4 * C.BEAT + C.GOOD)) < 1e-8); assert.equal(s.time, s.endTime);
});

test('empty input cannot farm survival points or consume a note failure', () => {
  const s = new C.Session(3, () => {}, { phase: 2 });
  for (let i = 0; i < 10; i++) { s.press(0, 1); s.release(0); }
  assert.equal(s.failures, 0); assert.equal(s.score, 0); assert.equal(s.counts.stray, 0);
});

test('ten minutes of survival generate fresh notes on the beat with bounded memory and no time limit', () => {
  const s = new C.Session(42, () => {}, { phase: 2 });
  let count = 0, lastHit = 0;
  while (lastHit < 600) {
    const n = s.chart.find(n => !n.resolved);
    assert.ok(n); assert.ok(n.hit > lastHit); assert.ok(Math.abs((n.hit - C.BEAT_OFFSET) / C.BEAT - Math.round((n.hit - C.BEAT_OFFSET) / C.BEAT)) < 1e-8);
    assert.ok(n.lanes.length === 1 || C.PAIRS.some(pair => pair.join() === n.lanes.join()));
    assert.ok(n.travel <= 1.2); assert.ok(s.chart.length < 24);
    hit(s, n); lastHit = n.hit; count++;
  }
  assert.equal(s.finished, false); assert.equal(s.failures, 0); assert.equal(s.counts.perfect, count);
  assert.equal(s.score, count * 6 - 5); assert.equal(s.bonusScore, count - 5);
  assert.ok(s.time >= 600 && s.time < 600 + C.BEAT); assert.ok(C.speedAt(s.time, 2) >= 12);
});

test('before the first note and between notes, empty taps never emit a judgement or damage a charged streak', () => {
  const events = [], s = new C.Session(42, e => events.push(e));
  for (const at of [-3, 0, .5, 1.5, C.FIRST_HIT - .17]) for (let lane = 0; lane < 4; lane++) {
    s.press(lane, at); s.release(lane);
  }
  assert.equal(events.length, 0); assert.equal(s.score, 0); assert.equal(s.counts.miss, 0);
  for (const n of s.chart.slice(0, 6)) hit(s, n);
  const before = { score: s.score, combo: s.combo, bonus: s.bonusScore, accuracy: s.accuracy };
  for (let lane = 0; lane < 4; lane++) { s.press(lane, s.chart[6].hit - .3); s.release(lane); }
  assert.deepEqual({ score: s.score, combo: s.combo, bonus: s.bonusScore, accuracy: s.accuracy }, before);
  hit(s, s.chart[6]); assert.equal(s.bonusScore, 2); assert.equal(s.counts.stray, 0);
});
test('music chart v2 has 182 judgements and leaves enough time for the final late window', () => {
  assert.equal(C.PRACTICE, 15); assert.equal(C.CHART_VERSION, 2); assert.equal(C.BEAT, .6);
  for (const seed of [1, 42, 999]) {
    const chart = C.createChart(seed);
    assert.equal(chart.length, 182); assert.equal(chart[0].hit, 2.865);
    assert.ok(chart.at(-1).hit + C.GOOD < C.DURATION);
    assert.ok(chart.some(n => n.spawn >= 15 && n.spawn < 18 && n.lanes.length === 2));
  }
});
