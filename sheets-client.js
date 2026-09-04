(() => {
  'use strict';
  let connection = null;
  function connect() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      const endpoint = window.HwarakRecordConfig?.endpoint;
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint || '')) return reject(new Error('기록 서버 연결을 준비하고 있어요.'));
      if (!/^https?:$/.test(location.protocol)) return reject(new Error('배포된 게임 주소에서 기록을 저장해 주세요.'));
      const channel = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
      const frame = document.createElement('iframe'); frame.hidden = true; frame.title = '기록 저장 연결'; frame.referrerPolicy = 'no-referrer';
      let peer = null, peerOrigin = '', sequence = 0; const pending = new Map();
      const timeout = setTimeout(() => { window.removeEventListener('message', receive); frame.remove(); connection = null; reject(new Error('기록 서버 연결이 지연되고 있어요. 인터넷 연결을 확인해 주세요.')); }, 20000);
      function receive(event) {
        const m = event.data;
        if (!m || m.channel !== channel || !/^https:\/\/[a-z0-9-]+\.googleusercontent\.com$/.test(event.origin)) return;
        if (!peer && m.type === 'ready' && event.source) {
          peer = event.source; peerOrigin = event.origin; clearTimeout(timeout);
          resolve((action, payload) => new Promise((done, fail) => {
            const id = String(++sequence), timer = setTimeout(() => { pending.delete(id); fail(new Error('저장 여부를 확인하지 못했어요. 같은 기록으로 다시 눌러 주세요.')); }, 30000);
            pending.set(id, { done, fail, timer }); peer.postMessage({ type: 'request', channel, id, action, payload }, peerOrigin);
          }));
        } else if (event.source === peer && event.origin === peerOrigin && m.type === 'response' && pending.has(m.id)) {
          const task = pending.get(m.id); pending.delete(m.id); clearTimeout(task.timer);
          if (m.data?.ok) task.done(m.data); else { const error = new Error(m.data?.error || '다시 시도해 주세요.'); error.code = m.data?.code; task.fail(error); }
        }
      }
      window.addEventListener('message', receive);
      frame.src = endpoint + '?origin=' + encodeURIComponent(location.origin) + '&channel=' + channel; document.body.append(frame);
    });
    connection.catch(() => { connection = null; }); return connection;
  }
  window.HwarakRecords = { request: async (action, payload) => (await connect())(action, payload) };
  // Warm up during the opening so a slow first connection does not delay run registration.
  if (window.HwarakRecordConfig?.endpoint) void connect().catch(() => {});
})();
