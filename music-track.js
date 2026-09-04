(function (root, factory) {
  const track = Object.freeze(factory());
  if (typeof module === 'object' && module.exports) module.exports = track;
  else root.HwarakTrack = track;
})(globalThis, function () {
  return {
    version: 2, title: 'Dance Dance Music', artist: 'The Mountain',
    asset: 'beats/the_mountain-dance-dance-music-576566.mp3',
    bpm: 100, beatOffset: 0.465, firstBeat: 4,
    // 32 whole bars, with both boundaries immediately before the same beat phase.
    loopStart: 20.25, loopEnd: 97.05, loopFade: 0.012
  };
});
