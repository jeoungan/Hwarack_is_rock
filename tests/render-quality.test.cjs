const test = require('node:test');
const assert = require('node:assert/strict');
const { Controller } = require('../render-quality.js');
function sample(controller, ms, duration, active = true) {
  for (let t = 0; t < duration; t += ms) controller.observe(ms, active);
}
test('60/120 Hz rendering stays at full quality, and large canvases respect pixel budget', () => {
  const q = new Controller(); sample(q, 16.67, 20000); sample(q, 8.33, 20000);
  assert.equal(q.profile.name, 'high');
  const ratio = q.ratio(3840, 2160, 2);
  assert.ok(3840 * 2160 * ratio ** 2 <= 3000001);
});
test('sustained slow rendering lowers quality in steps without oscillation', () => {
  const q = new Controller(); sample(q, 33.33, 5700);
  assert.equal(q.profile.name, 'balanced');
  sample(q, 40, 5700); assert.equal(q.profile.name, 'light');
  sample(q, 16.67, 30000); assert.equal(q.profile.name, 'light'); assert.equal(q.changes, 2);
  assert.equal(q.profile.motes, 76); assert.equal(q.ratio(844, 320, 3), 1);
});
test('short spikes, inactive time and tab suspension do not lower quality', () => {
  const q = new Controller(); sample(q, 16.67, 4000); sample(q, 70, 600); sample(q, 16.67, 5000);
  sample(q, 100, 30000, false); q.observe(4000, true); sample(q, 16.67, 3000);
  assert.equal(q.profile.name, 'high'); assert.equal(q.changes, 0);
});
