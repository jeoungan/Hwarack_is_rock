const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../rhythm-core.js');

test('100 random charts preserve the practice boundary, beat grid, supported chords and increasing speed', () => {
  const valid = new Set(C.PAIRS.map(pair => pair.join(',')));
  for (let seed = 1; seed <= 100; seed++) {
    const chart = C.createChart(seed);
    assert.deepEqual(chart.slice(0, 4).map(note => note.lanes[0]).sort(), [0, 1, 2, 3]);
    assert.ok(chart.some(note => note.lanes.length === 2));
    assert.ok(chart.every(note => note.spawn >= 0 && note.hit < 120 && Math.abs((note.hit - C.BEAT_OFFSET) / (C.BEAT / 2) - Math.round((note.hit - C.BEAT_OFFSET) / (C.BEAT / 2))) < 1e-8));
    assert.ok(chart.filter(note => note.spawn < 15).every(note => note.lanes.length === 1));
    assert.ok(chart.every(note => note.lanes.length === 1 || valid.has(note.lanes.join(','))));
    for (let i = 1; i < chart.length; i++) {
      assert.ok(chart[i].hit > chart[i - 1].hit);
      assert.ok(chart[i].travel <= chart[i - 1].travel);
    }
    assert.ok(chart.at(-1).travel >= 1.5 && chart.at(-1).travel < 1.51);
  }
});
test('same seed reproduces a chart; a new seed changes it', () => {
  assert.deepEqual(C.createChart(7), C.createChart(7));
  assert.notDeepEqual(C.createChart(7).map(n => n.lanes), C.createChart(8).map(n => n.lanes));
});
test('five timing grades have inclusive boundaries, symmetric early/late windows and 5/4/3/2/0 points', () => {
  for (const sign of [-1, 1]) for (const [delta, grade] of [[0, 'perfect'], [.08, 'perfect'], [.0801, 'special'], [.13, 'special'], [.1301, 'great'], [.18, 'great'], [.1801, 'good'], [.24, 'good']]) {
    const s = new C.Session(5), n = s.chart[0];
    s.press(n.lanes[0], n.hit + sign * delta);
    assert.equal(n.judgement, grade, `${sign * delta}s`);
    assert.equal(s.score, C.POINTS[grade]);
  }
  const s = new C.Session(5); s.advance(s.chart[0].hit + .2401);
  assert.equal(s.chart[0].judgement, 'miss'); assert.equal(s.score, 0);
  s.advance(s.chart[0].hit + .3); assert.equal(s.score, 0, 'a miss never awards points'); assert.equal(s.counts.miss, 1);
});
test('a chord accepts two timely presses and counts as one displayed judgement and streak event', () => {
  const s = new C.Session(9), chord = s.chart.find(n => n.lanes.length === 2);
  s.advance(chord.hit - .05);
  const before = s.score;
  s.press(chord.lanes[0], chord.hit - .04);
  assert.equal(chord.resolved, false);
  s.press(chord.lanes[1], chord.hit + .02);
  assert.equal(chord.judgement, 'perfect'); assert.equal(s.score, before + 5); assert.equal(s.combo, 1);
  assert.equal(s.counts.perfect, 1); assert.equal(s.perfectStreak, 1);
});
test('chord taps more than 180ms apart expire, whether held or released', () => {
  for (const separated of [true, false]) {
    const s = new C.Session(9), chord = s.chart.find(n => n.lanes.length === 2);
    s.press(chord.lanes[0], chord.hit - .12);
    if (separated) s.release(chord.lanes[0]);
    s.press(chord.lanes[1], chord.hit + .10);
    s.advance(chord.hit + .25);
    assert.equal(chord.judgement, 'miss'); assert.equal(s.score, 0);
  }
});
test('held/repeated input cannot clear later notes; held keys never generate repeat attempts', () => {
  const s = new C.Session(15), first = s.chart[0];
  s.press(first.lanes[0], first.hit);
  const later = s.chart.find(n => n.id > first.id && n.lanes.includes(first.lanes[0]));
  s.press(first.lanes[0], later.hit); s.advance(later.hit + .25);
  assert.equal(later.judgement, 'miss');
  s.clearHeld(); s.press(0, 119.99);
  assert.equal(s.combo, 0); assert.equal(s.counts.stray, 0);
});
test('all misses still complete the two-minute round', () => {
  const s = new C.Session(5); s.advance(120);
  assert.equal(s.finished, true); assert.equal(s.score, 0);
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
    if (grade === 'miss') s.advance(breaker.hit + .25);
    else hit(s, breaker, { special: .10, great: .16, good: .22 }[grade]);
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
  assert.equal(s.score, 0); assert.equal(s.perfectStreak, 0); assert.equal(s.counts.stray, 40); assert.equal(s.penaltyScore, 120); assert.equal(s.accuracy, 100 / 41);
});
test('a fully Perfect round has exactly chart.length - 5 bonus points including chords', () => {
  const s = new C.Session(42); for (const n of s.chart) hit(s, n); s.advance(120);
  assert.equal(s.counts.perfect, s.chart.length); assert.equal(s.bonusScore, s.chart.length - 5);
  assert.equal(s.score, s.chart.length * 6 - 5); assert.equal(s.accuracy, 100);
});

test('all chords cross the two hands and phase-one speed reaches exactly 1.6x at 120 seconds', () => {
  assert.deepEqual(C.PAIRS, [[0, 3], [1, 2], [0, 2], [1, 3]]);
  for (const [time, speed] of [[0, 1], [15, 1], [67.5, 1.3], [120, 1.6], [200, 1.6]]) assert.equal(C.speedAt(time), speed);
  for (const [time, speed] of [[0, 1.6], [45, 2.1], [90, 2.6], [180, 3.6]]) assert.equal(C.speedAt(time, 2), speed);
});

test('survival ends at exactly five Misses; every successful grade preserves remaining lives', () => {
  const s = new C.Session(42, () => {}, { phase: 2 });
  const offsets = [.16, .10, .22, 0, .25, .08, .16, .22, .25, .16, .25, .22, .25, 0, .25];
  let failures = 0;
  for (const offset of offsets) {
    const n = s.chart.find(n => !n.resolved);
    if (offset > C.GOOD) s.advance(n.hit + offset); else hit(s, n, offset);
    if (offset > C.GOOD) failures++;
    assert.equal(s.failures, failures);
    assert.equal(s.finished, failures === 5);
  }
  assert.equal(s.endReason, 'eliminated');
  assert.equal(s.counts.great, 3); assert.equal(s.counts.good, 3); assert.equal(s.counts.miss, 5);
  const frozen = { score: s.score, endTime: s.endTime, counts: { ...s.counts } };
  s.advance(600); s.press(0, 601); s.resolve(s.chart.find(n => !n.resolved), 'perfect', 0);
  assert.deepEqual({ score: s.score, endTime: s.endTime, counts: s.counts }, frozen);
  assert.deepEqual(s.visible(), []);
});

test('a failed two-key chord consumes one life; late input cannot score after the fifth missed note', () => {
  const s = new C.Session(3, () => {}, { phase: 2 });
  const chord = s.chart[0]; assert.equal(chord.lanes.length, 2);
  s.press(chord.lanes[0], chord.hit); s.release(chord.lanes[0]); s.advance(chord.hit + .25);
  assert.equal(s.failures, 1); assert.equal(s.score, 0);
  s.press(0, 100);
  assert.equal(s.failures, 5); assert.equal(s.score, 0); assert.equal(s.counts.stray, 0);
  assert.ok(Math.abs(s.endTime - (C.FIRST_HIT + 1.8 + C.GOOD)) < 1e-8); assert.equal(s.time, s.endTime);
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
    assert.ok(n); assert.ok(n.hit > lastHit); assert.ok(Math.abs((n.hit - C.BEAT_OFFSET) / (C.BEAT / 2) - Math.round((n.hit - C.BEAT_OFFSET) / (C.BEAT / 2))) < 1e-8);
    assert.ok(n.lanes.length === 1 || C.PAIRS.some(pair => pair.join() === n.lanes.join()));
    assert.ok(n.travel <= 1.5); assert.ok(s.chart.length < 24);
    hit(s, n); lastHit = n.hit; count++;
  }
  assert.equal(s.finished, false); assert.equal(s.failures, 0); assert.equal(s.counts.perfect, count);
  assert.equal(s.score, count * 6 - 5); assert.equal(s.bonusScore, count - 5);
  assert.ok(s.time >= 600 && s.time < 600 + C.BEAT); assert.ok(C.speedAt(s.time, 2) >= 8);
});

test('warm-up taps are free; empty taps during the round deduct points and break the streak', () => {
  const events = [], s = new C.Session(42, e => events.push(e));
  for (const at of [-3, 0, .5, 1.5, C.FIRST_HIT - .25]) for (let lane = 0; lane < 4; lane++) {
    s.press(lane, at); s.release(lane);
  }
  assert.equal(events.length, 0); assert.equal(s.score, 0); assert.equal(s.counts.miss, 0);
  for (const n of s.chart.slice(0, 6)) hit(s, n);
  const before = { score: s.score, combo: s.combo, bonus: s.bonusScore, accuracy: s.accuracy };
  for (let lane = 0; lane < 4; lane++) { s.press(lane, s.chart[6].hit - .3); s.release(lane); }
  assert.equal(s.score, before.score - 12); assert.equal(s.combo, 0); assert.equal(s.bonusScore, before.bonus); assert.equal(s.accuracy, 60);
  hit(s, s.chart[6]); assert.equal(s.bonusScore, 1); assert.equal(s.counts.stray, 4); assert.equal(s.perfectStreak, 1);
});
test('music chart v5 preserves density and leaves enough time for the final late window', () => {
  assert.equal(C.PRACTICE, 15); assert.equal(C.CHART_VERSION, 5); assert.equal(C.BEAT, .6);
  for (const seed of [1, 42, 999]) {
    const chart = C.createChart(seed);
    assert.equal(chart.length, 280); assert.equal(chart[0].hit, 2.865);
    assert.ok(chart.at(-1).hit + C.GOOD < C.DURATION);
    assert.ok(chart.some(n => n.spawn >= 15 && n.spawn < 18 && n.lanes.length === 2));
  }
});

test('dense notes alternate lanes, including every chord, across 100 seeds and both phases', () => {
  for (let seed = 0; seed < 100; seed++) for (const phase of [1, 2]) {
    const s = new C.Session(seed, () => {}, { phase });
    if (phase === 2) s.fillAhead(120);
    for (let i = 1; i < s.chart.length; i++) {
      const a = s.chart[i - 1], b = s.chart[i], gap = b.hit - a.hit;
      assert.ok(Math.abs(gap - .6) < 1e-8 || Math.abs(gap - .3) < 1e-8);
      if (gap < .31) assert.ok(b.lanes.every(lane => !a.lanes.includes(lane)));
    }
  }
});

test('rolled chord taps stay valid after the first finger is lifted, including the 180ms boundary', () => {
  for (const [early, late, grade] of [[-.08, .08, 'perfect'], [-.12, .06, 'special']]) {
    const s = new C.Session(9), n = s.chart.find(n => n.lanes.length === 2);
    s.press(n.lanes[0], n.hit + early); s.release(n.lanes[0]);
    s.press(n.lanes[1], n.hit + late); s.release(n.lanes[1]);
    assert.equal(n.judgement, grade); assert.equal(s.counts[grade], 1);
    s.advance(n.hit + .25); assert.equal(n.judgement, grade);
  }
});
test('survival alternates breathing beats and half-beat accents', () => {
  const s = new C.Session(42, () => {}, { phase: 2 }); s.fillAhead(7);
  assert.deepEqual(s.chart.slice(0, 7).map(n => n.hit), [2.865, 3.465, 3.765, 4.065, 4.665, 4.965, 5.265]);
});

test('wrong keys cost three points without consuming a real note; all five grades still total 280', () => {
  const s = new C.Session(42), n = s.chart[0], wrong = (n.lanes[0] + 1) % 4;
  s.press(wrong, n.hit); s.release(wrong);
  assert.equal(n.resolved, false); assert.equal(s.counts.stray, 1);
  hit(s, n); assert.equal(s.score, 2); assert.equal(s.accuracy, 50);
  s.advance(120);
  assert.equal(s.counts.perfect + s.counts.special + s.counts.great + s.counts.good + s.counts.miss, 280);
});

test('deductions persist at zero and are not erased by the next successful note', () => {
  const s = new C.Session(42), n = s.chart[0], wrong = (n.lanes[0] + 1) % 4;
  for (let i = 0; i < 2; i++) { s.press(wrong, n.hit - .20 + i * .01); s.release(wrong); }
  assert.equal(s.score, 0); assert.equal(s.penaltyScore, 6);
  hit(s, n); assert.equal(s.score, 0);
  hit(s, s.chart[1]); assert.equal(s.score, 4);
});

test('a chord first attempt cannot be improved by re-tapping or clearing held keys', () => {
  for (const clear of [false, true]) {
    const s = new C.Session(42), n = s.chart.find(n => n.lanes.length === 2);
    s.press(n.lanes[0], n.hit - .10); s.release(n.lanes[0]);
    if (clear) s.clearHeld();
    s.press(n.lanes[0], n.hit); s.release(n.lanes[0]);
    s.press(n.lanes[1], n.hit); s.release(n.lanes[1]);
    assert.equal(n.judgement, 'special'); assert.equal(s.counts.stray, 1);
    assert.equal(n.attempts[n.lanes[0]].time, n.hit - .10);
  }
});

test('expired chord attempts cannot be retried within the late timing window', () => {
  const s = new C.Session(42), n = s.chart.find(n => n.lanes.length === 2);
  s.press(n.lanes[0], n.hit - .23); s.release(n.lanes[0]);
  s.advance(n.hit); assert.equal(n.inputs[n.lanes[0]], undefined);
  hit(s, n); s.advance(n.hit + .25);
  assert.equal(n.judgement, 'miss'); assert.equal(s.counts.stray, 1);
  assert.equal(s.counts.perfect, 0);
});

test('100 random charts still allow a 280-combo all-Perfect round worth exactly 1675', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const s = new C.Session(seed);
    for (const n of s.chart) hit(s, n);
    s.advance(120);
    assert.equal(s.score, 1675); assert.equal(s.counts.stray, 0);
    assert.equal(s.maxCombo, 280); assert.equal(s.accuracy, 100);
  }
});

test('500 bursts of all four keys and faster blind mashing cannot earn a positive phase-one score', () => {
  for (const seed of [1, 7, 42, 100]) for (const step of [.24, .12, .06]) {
    const s = new C.Session(seed);
    for (let i = 0; i * step < 120; i++) {
      for (let lane = 0; lane < 4; lane++) s.press(lane, i * step);
      for (let lane = 0; lane < 4; lane++) s.release(lane);
    }
    s.advance(120);
    assert.equal(s.score, 0); assert.equal(s.combo, 0); assert.ok(s.counts.stray > 0);
    assert.equal(s.bonusScore, 0);
  }
});

test('pressing all four keys on every correct beat no longer bypasses lane selection', () => {
  const s = new C.Session(42);
  for (const n of s.chart) {
    for (let lane = 0; lane < 4; lane++) s.press(lane, n.hit);
    for (let lane = 0; lane < 4; lane++) s.release(lane);
  }
  s.advance(120);
  assert.equal(s.counts.perfect, 280); assert.equal(s.score, 0);
  assert.ok(s.accuracy < 30); assert.ok(s.maxCombo < 3); assert.equal(s.bonusScore, 0);
});

test('five wrong attempts end survival before a single note resolves, then freeze all state', () => {
  const events = [], s = new C.Session(42, e => events.push(e), { phase: 2 });
  const n = s.chart[0], wrong = [0, 1, 2, 3].find(lane => !n.lanes.includes(lane));
  for (let i = 0; i < 5; i++) { s.press(wrong, n.hit - .20 + i * .01); s.release(wrong); }
  assert.equal(s.finished, true); assert.equal(s.counts.stray, 5); assert.equal(s.counts.miss, 0);
  assert.equal(s.endTime, n.hit - .16); assert.equal(s.failures, 5); assert.equal(events.length, 5);
  const frozen = JSON.stringify({ score: s.score, counts: s.counts, endTime: s.endTime });
  s.advance(600); s.press(wrong, 600); s.resolve(n, 'perfect', 0);
  assert.equal(JSON.stringify({ score: s.score, counts: s.counts, endTime: s.endTime }), frozen);
});

test('Miss and wrong attempts share the five-failure limit; normal chord presses count once', () => {
  const s = new C.Session(42, () => {}, { phase: 2 });
  s.advance(s.chart[0].hit + .25); assert.equal(s.failures, 1);
  const n = s.chart.find(n => !n.resolved);
  hit(s, n); assert.equal(s.failures, 1);
  for (let i = 0; i < 4; i++) { s.press(n.lanes[0], n.hit + .01 * (i + 1)); s.release(n.lanes[0]); }
  assert.equal(s.finished, true); assert.equal(s.counts.miss, 1); assert.equal(s.counts.stray, 4);
});

test('blind four-key mashing cannot keep the challenge alive', () => {
  for (const step of [.24, .12, .06]) {
    const s = new C.Session(42, () => {}, { phase: 2 });
    for (let i = 0; i * step < 10 && !s.finished; i++) {
      for (let lane = 0; lane < 4; lane++) s.press(lane, i * step);
      for (let lane = 0; lane < 4; lane++) s.release(lane);
    }
    assert.equal(s.finished, true); assert.equal(s.failures, 5);
    assert.ok(s.endTime < 4); assert.equal(s.score, 0);
  }
});

test('last-note extra keys are penalized, but waiting after its full window is free', () => {
  const s = new C.Session(42), n = s.chart.at(-1);
  for (const note of s.chart) hit(s, note);
  s.press(n.lanes[0], n.hit + .01); s.release(n.lanes[0]);
  assert.equal(s.score, 1672); assert.equal(s.counts.stray, 1);
  s.press(n.lanes[0], n.hit + .25); s.release(n.lanes[0]);
  assert.equal(s.counts.stray, 1);
});
