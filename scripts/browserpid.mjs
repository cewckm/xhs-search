// browserpid.mjs — find the OS process id of the debugged browser (via SystemInfo).
const v = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const info = await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('timeout')), 10000);
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id === 1) { clearTimeout(to); resolve(m.result); }
  });
  ws.send(JSON.stringify({ id: 1, method: 'SystemInfo.getProcessInfo' }));
});
ws.close();
console.log(JSON.stringify(info));
