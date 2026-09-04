// Record submission only. Ranking lives on ranking.html.
(() => {
  'use strict';
  const $ = id => document.getElementById(id), modal = $('leaderboard-modal');
  let round = null, returnFocus = null;
  const clock = value => { const tenth = Math.floor(value * 10 + 1e-6); return `${Math.floor(tenth / 600)}분 ${(tenth % 600 / 10).toFixed(1)}초`; };
  function close() { if (modal.open) modal.close(); }
  function abandon() { close(); round = null; }
  function begin(seed, phase) {
    close();
    const current = round = { events: [], phase, result: null, saved: null, pending: false, overflow: false };
    $('record-button').textContent = '기록 저장하기'; $('record-name').value = '';
    current.ticket = window.HwarakRecords.request('begin', { seed: seed >>> 0, phase })
      .then(data => data.ticket).catch(error => { current.ticketError = error.message; return null; });
  }
  function capture(type, lane, time) {
    if (!round || round.result || time < 0 || !Number.isFinite(time)) return;
    if (round.events.length >= 60000) { round.overflow = true; return; }
    round.events.push([type, lane, Math.max(time, round.events.at(-1)?.[2] || 0)]);
  }
  function complete(session) {
    if (round && !round.result) round.result = { score: session.score, time: session.endTime, phase: session.phase };
  }
  function open() {
    if (!round?.result) return;
    const result = round.result;
    $('record-summary').textContent = `${result.phase}페이즈 · ${result.phase === 2 ? clock(result.time) + ' 생존 · ' : ''}${result.score.toLocaleString('ko-KR')}점`;
    $('record-submit').disabled = $('record-name').disabled = !!round.saved || round.pending;
    $('record-submit').textContent = round.saved ? '저장 완료' : '기록 저장하기';
    $('record-status').textContent = round.saved ? '기록이 저장됐어요. 참여해 주셔서 감사합니다!' : round.pending ? '기록을 저장하는 중…' : '';
    returnFocus = document.activeElement; modal.showModal(); $('leaderboard-close').focus({ preventScroll: true });
  }
  $('record-form').addEventListener('submit', async event => {
    event.preventDefault(); const current = round;
    if (!current?.result || current.pending || current.saved) return;
    const name = $('record-name').value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if ([...name].length < 1 || [...name].length > 16 || !/^[\p{L}\p{N}\p{M} ._\-]+$/u.test(name)) { $('record-status').textContent = '이름은 한글·영문·숫자 등 1~16자로 입력해 주세요.'; return; }
    if (current.overflow) { $('record-status').textContent = '입력 기록이 너무 길어 저장할 수 없어요.'; return; }
    current.pending = true; $('record-submit').disabled = $('record-name').disabled = true; $('record-status').textContent = '기록을 확인하고 저장하는 중…';
    try {
      const ticket = await current.ticket;
      if (!ticket) throw new Error((current.ticketError || '시작 기록을 확인하지 못했어요.') + ' 인터넷 연결 후 새 게임에서 다시 도전해 주세요.');
      const data = await window.HwarakRecords.request('save', { ticket, name, events: current.events, endTime: current.result.time });
      current.saved = data.entry;
      if (round !== current) return;
      $('record-button').textContent = '기록 저장 완료'; $('record-submit').textContent = '저장 완료';
      $('record-status').textContent = data.duplicate ? '이미 저장된 기록이에요. 중복으로 저장하지 않았어요.' : '기록이 저장됐어요. 참여해 주셔서 감사합니다!';
    } catch (error) { if (round === current) $('record-status').textContent = error.message; }
    finally { current.pending = false; if (round === current) $('record-submit').disabled = $('record-name').disabled = !!current.saved; }
  });
  $('record-button').addEventListener('click', open); $('leaderboard-close').addEventListener('click', close);
  modal.addEventListener('close', () => returnFocus?.focus?.({ preventScroll: true }));
  window.HwarakLeaderboard = { begin, capture, complete, abandon, isOpen: () => modal.open };
})();
