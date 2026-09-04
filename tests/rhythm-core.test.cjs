const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../rhythm-core.js');

test('100 random charts preserve the practice boundary, beat grid, supported chords and increasing speed', () => {
  const valid = new Set(C.PAIRS.map(pair => pair.join(',')));
  for (let seed = 1; seed <= 100; seed++) {
    const chart = C.createChart(seed);
    assert.deepEqual(chart.slice(0, 4).map(note => note.lanes[0]).sort(), [0, 1, 2, 3]);
    assert.ok(chart.some(note => note.lanes.length === 2));
    assert.ok(chart.every(note => note.spawn >= 0 && note.hit < 120 && note.hit * 2 === Math.round(note.hit * 2)));
    assert.ok(chart.filter(note => note.spawn < 30).every(note => note.lanes.length === 1));
    assert.ok(chart.every(note => note.lanes.length === 1 || valid.has(note.lanes.join(','))));
    for (let i = 1; i < chart.length; i++) {
      assert.ok(chart[i].hit > chart[i - 1].hit);
      assert.ok(chart[i].travel <= chart[i - 1].travel);
    }
    assert.ok(chart.at(-1).travel < 1);
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
test('held/repeated input cannot clear later notes, and mistimed input breaks a combo', () => {
  const s = new C.Session(15), first = s.chart[0];
  s.press(first.lanes[0], first.hit);
  const later = s.chart.find(n => n.id > first.id && n.lanes.includes(first.lanes[0]));
  s.press(first.lanes[0], later.hit); s.advance(later.hit + .17);
  assert.equal(later.judgement, 'miss');
  s.clearHeld(); s.press(0, 119.99);
  assert.equal(s.combo, 0); assert.ok(s.counts.stray > 0);
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
  for (const grade of ['special', 'great', 'good', 'miss', 'stray']) {
    const s = new C.Session(7);
    for (const n of s.chart.slice(0, 6)) hit(s, n);
    assert.equal(s.bonusScore, 1);
    const breaker = s.chart[6];
    if (grade === 'miss') s.advance(breaker.hit + .17);
    else if (grade === 'stray') { s.press(0, breaker.hit - .3); s.release(0); }
    else hit(s, breaker, { special: .06, great: .10, good: .14 }[grade]);
    assert.equal(s.perfectStreak, 0, grade);
    assert.equal(s.bonusScore, 1, grade);
    const restart = grade === 'stray' ? 6 : 7;
    for (const n of s.chart.slice(restart, restart + 5)) hit(s, n);
    assert.equal(s.perfectStreak, 5); assert.equal(s.bonusScore, 1);
    hit(s, s.chart[restart + 5]); assert.equal(s.bonusScore, 2);
  }
});
test('empty taps and repeated resolution cannot farm points', () => {
  const s = new C.Session(12), n = s.chart[0]; hit(s, n);
  s.resolve(n, 'perfect', 0); assert.equal(s.score, 5);
  for (let i = 0; i < 40; i++) { s.press(0, n.hit + .3); s.release(0); }
  assert.equal(s.score, 5); assert.equal(s.perfectStreak, 0); assert.equal(s.counts.stray, 40);
});
test('a fully Perfect round has exactly chart.length - 5 bonus points including chords', () => {
  const s = new C.Session(42); for (const n of s.chart) hit(s, n); s.advance(120);
  assert.equal(s.counts.perfect, s.chart.length); assert.equal(s.bonusScore, s.chart.length - 5);
  assert.equal(s.score, s.chart.length * 6 - 5); assert.equal(s.accuracy, 100);
});
