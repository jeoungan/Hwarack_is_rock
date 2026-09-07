// Record submission only. Ranking lives on ranking.html.
(() => {
  'use strict';
  const $ = id => document.getElementById(id), modal = $('leaderboard-modal');
  const fields = ['name', 'phone', 'email'];
  let round = null, returnFocus = null;
  const clock = value => { const tenth = Math.floor(value * 10 + 1e-6); return `${Math.floor(tenth / 600)}분 ${(tenth % 600 / 10).toFixed(1)}초`; };
  function close() { if (modal.open) modal.close(); }
  function resetFields() {
    for (const field of fields) { $('record-' + field).value = ''; clearError(field); }
    $('record-status').textContent = '';
  }
  function clearError(field) {
    $('record-' + field).removeAttribute('aria-invalid');
    $('record-' + field + '-error').hidden = true;
    $('record-' + field + '-error').textContent = '';
  }
  function invalid(field, message) {
    const input = $('record-' + field), error = $('record-' + field + '-error');
    input.setAttribute('aria-invalid', 'true'); error.textContent = message; error.hidden = false;
    $('record-status').textContent = message; input.focus();
  }
  function lock(locked) {
    $('record-submit').disabled = locked;
    for (const field of fields) $('record-' + field).disabled = locked;
  }
  function abandon() { close(); round = null; resetFields(); }
  function begin(seed, phase) {
    close();
    const current = round = { phase, result: null, saved: null, pending: false };
    $('record-button').textContent = '기록 저장하기'; resetFields();
    current.ticket = Promise.resolve().then(() => {
      if (!window.HwarakRecords) throw new Error('기록 서버 파일을 불러오지 못했어요.');
      return window.HwarakRecords.request('begin', { seed: seed >>> 0, phase, chartVersion: window.HwarakCore.CHART_VERSION });
    })
      .then(data => data.ticket).catch(error => { current.ticketError = error.message; return null; });
  }
  function complete(session) {
    if (round && !round.result) round.result = { score: session.score, time: session.endTime, phase: session.phase,
      accuracy: +session.accuracy.toFixed(1), grade: session.accuracy >= 95 ? 'S' : session.accuracy >= 85 ? 'A' : session.accuracy >= 70 ? 'B' : 'C',
      counts: { ...session.counts }, bonus: session.bonusScore, maxCombo: session.maxCombo };
  }
  function open() {
    if (!round?.result) return;
    const result = round.result;
    $('record-summary').textContent = `${result.phase}페이즈 · ${result.phase === 2 ? clock(result.time) + ' 생존 · ' : ''}${result.score.toLocaleString('ko-KR')}점`;
    lock(!!round.saved || round.pending);
    $('record-submit').textContent = round.saved ? '저장 완료' : round.pending ? '저장하는 중…' : '기록 저장하기';
    $('record-status').textContent = round.saved ? '기록이 저장됐어요. 참여해 주셔서 감사합니다!' : round.pending ? '기록을 저장하는 중…' : '';
    returnFocus = document.activeElement; modal.showModal(); $('leaderboard-close').focus({ preventScroll: true });
  }
  $('record-form').addEventListener('submit', async event => {
    event.preventDefault(); const current = round;
    if (!current?.result || current.pending || current.saved) return;
    fields.forEach(clearError);
    const name = $('record-name').value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if ([...name].length < 1 || [...name].length > 16 || !/^[\p{L}\p{N}\p{M} ._\-]+$/u.test(name)) { invalid('name', '이름은 한글·영문·숫자 등 1~16자로 입력해 주세요.'); return; }
    const phone = $('record-phone').value.trim(), email = $('record-email').value.trim();
    const digits = phone.replace(/[^0-9]/g, '');
    if (phone && (phone.length > 32 || !/^\+?[0-9 ()-]+$/.test(phone) || digits.length < 8 || digits.length > 15)) { invalid('phone', '전화번호는 숫자 8~15자리로 입력해 주세요. +, 공백, 괄호, -를 사용할 수 있어요.'); return; }
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email))) { invalid('email', '이메일을 확인해 주세요. 예: yourname@example.com'); return; }
    current.pending = true; lock(true); $('record-submit').textContent = '저장하는 중…'; $('record-status').textContent = '기록을 확인하고 저장하는 중…';
    try {
      const ticket = await current.ticket;
      if (!ticket) throw new Error((current.ticketError || '시작 기록을 확인하지 못했어요.') + ' 인터넷 연결 후 새 게임에서 다시 도전해 주세요.');
      const data = await window.HwarakRecords.request('save', { ticket, name, ...(phone ? { phone } : {}), ...(email ? { email } : {}), result: current.result });
      current.saved = data.entry;
      if (round !== current) return;
      resetFields();
      $('record-button').textContent = '기록 저장 완료'; $('record-submit').textContent = '저장 완료';
      $('record-status').textContent = data.duplicate ? '이미 저장된 기록이에요. 중복으로 저장하지 않았어요.' : '기록이 저장됐어요. 참여해 주셔서 감사합니다!';
    } catch (error) { if (round === current) $('record-status').textContent = error.message; }
    finally { current.pending = false; if (round === current) { lock(!!current.saved); $('record-submit').textContent = current.saved ? '저장 완료' : '기록 저장하기'; } }
  });
  for (const field of fields) $('record-' + field).addEventListener('input', () => { clearError(field); $('record-status').textContent = ''; });
  $('record-button').addEventListener('click', open); $('leaderboard-close').addEventListener('click', close);
  modal.addEventListener('close', () => returnFocus?.focus?.({ preventScroll: true }));
  window.HwarakLeaderboard = { begin, complete, abandon, isOpen: () => modal.open };
})();
