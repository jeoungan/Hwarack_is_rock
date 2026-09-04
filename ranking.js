(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let phase = 1, loading = false, timer = null, interval = 30, generation = 0, loaded = false;
  const clock = value => { const tenth = Math.floor(value * 10 + 1e-6); return `${Math.floor(tenth / 600)}:${(tenth % 600 / 10).toFixed(1).padStart(4, '0')}`; };
  function schedule() { clearTimeout(timer); if (!document.hidden) timer = setTimeout(load, interval * 1000); }
  async function load() {
    if (loading || document.hidden) return;
    loading = true; clearTimeout(timer); const version = generation, selected = phase;
    $('refresh').disabled = true; $('board-status').textContent = '기록을 불러오는 중…';
    try {
      const data = await window.HwarakRecords.request('ranking', { phase: selected });
      if (version !== generation) return;
      $('board-status').textContent = ''; loaded = true;
      $('announcement').textContent = data.announcement || '오늘 무대의 주인공들'; interval = data.refreshSeconds || 30;
      const rows = document.createDocumentFragment();
      for (const entry of data.entries.slice(0, 10)) {
        const row = document.createElement('tr');
        [entry.rank, entry.name, Number(entry.score).toLocaleString('ko-KR'), entry.grade, clock(entry.time)].forEach((value, index) => {
          const cell = document.createElement('td'); cell.textContent = value;
          if (index === 3) { cell.className = 'grade'; cell.dataset.grade = entry.grade; }
          row.append(cell);
        }); rows.append(row);
      }
      $('rows').replaceChildren(rows); $('empty').hidden = data.entries.length !== 0;
      $('updated').textContent = '최근 확인 ' + new Date(data.updatedAt).toLocaleTimeString('ko-KR'); $('interval').textContent = interval + '초마다 자동 확인';
    } catch (error) {
      if (version === generation) $('board-status').textContent = error.message + (loaded ? ' 표시된 기록은 마지막 확인 시점의 기록입니다.' : ' 새로고침을 눌러 다시 확인할 수 있어요.');
    } finally {
      loading = false; $('refresh').disabled = false;
      if (version !== generation) void load(); else schedule();
    }
  }
  $('refresh').addEventListener('click', load);
  document.querySelectorAll('[data-phase]').forEach(button => button.addEventListener('click', () => {
    const next = Number(button.dataset.phase); if (next === phase) return;
    phase = next; generation++; loaded = false; $('rows').replaceChildren(); $('empty').hidden = true;
    $('board-title').textContent = phase === 1 ? '점수 TOP 10' : '생존 TOP 10';
    $('rule').textContent = (phase === 1 ? '점수 → 정확도 순' : '생존 시간 → 점수 → 정확도 순') + ' · 상위 10개 기록';
    $('updated').textContent = '기록을 확인하고 있습니다.';
    document.querySelectorAll('[data-phase]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); void load();
  }));
  document.addEventListener('visibilitychange', () => document.hidden ? clearTimeout(timer) : void load());
  window.addEventListener('pagehide', () => clearTimeout(timer));
  void load();
})();
