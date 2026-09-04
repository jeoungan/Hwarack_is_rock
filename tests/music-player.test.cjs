const test = require('node:test');
const assert = require('node:assert/strict');
const track = require('../music-track.js');
const { Player, position } = require('../music-player.js');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function fixture() {
  const sources = [], gain = { gain: { setTargetAtTime() {} } };
  const ctx = { state: 'running', currentTime: 10, outputLatency: .1,
    createBufferSource() { const source = { connect() {}, disconnect() {}, stop() { this.stopped = true; }, start(...args) { this.args = args; } }; sources.push(source); return source; } };
  const player = new Player('music.mp3', track, { performance: { now: () => 5000 } });
  Object.assign(player, { context: ctx, buffer: {}, gain });
  return { player, ctx, sources };
}
test('128-beat loop preserves the chart beat phase for an unlimited survival round', () => {
  const beat = 60 / track.bpm, span = track.loopEnd - track.loopStart;
  near(span / beat, 128);
  for (const t of [0, 2.865, 96.465, 97.065, 120, 3600, 7200]) {
    const p = position(t, track);
    if (t < track.loopEnd) near(p, t);
    else { assert.ok(p >= track.loopStart && p < track.loopEnd); near((t - p) / beat, Math.round((t - p) / beat)); }
  }
  near(position(track.loopEnd - .001, track), track.loopEnd - .001);
  near(position(track.loopEnd, track), track.loopStart);
});
test('Ready schedules music at game zero, and the clock accounts for output latency', () => {
  const { player, ctx, sources } = fixture();
  assert.equal(player.start(-3.5), true); near(sources[0].args[0], 13.525); near(sources[0].args[1], 0);
  near(player.time(), -3.5);
  ctx.currentTime = 14.09; near(player.time(), .465);
  assert.equal(sources[0].loop, true); near(sources[0].loopStart, track.loopStart);
});
test('output timestamp uses the audible sample clock rather than advancing from animation frames', () => {
  const { player, ctx } = fixture(); player.start(0);
  ctx.currentTime = 11;
  ctx.getOutputTimestamp = () => ({ contextTime: 10.8, performanceTime: 4950 });
  near(player.time(), .825);
});
test('pause/resume and replay use the correct position; mute never restarts the track', () => {
  const { player, ctx, sources } = fixture();
  player.start(120); near(sources[0].args[1], position(120, track)); near(player.time(), 120);
  player.setEnabled(false); assert.equal(player.source, sources[0]);
  player.setEnabled(true); assert.equal(sources.length, 1);
  player.stop(); assert.equal(player.time(), null); assert.equal(sources[0].stopped, true);
  ctx.currentTime = 20; player.start(123.4); near(sources[1].args[1], position(123.4, track));
  player.start(-3.5); near(sources[2].args[1], 0); assert.equal(sources[1].stopped, true);
});
test('suspended or missing audio falls back without creating a silent fake playback clock', () => {
  const { player, ctx } = fixture(); ctx.state = 'suspended';
  assert.equal(player.start(0), false); assert.equal(player.time(), null);
});
