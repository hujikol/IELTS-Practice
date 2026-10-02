// UI smoke test driven over the Chrome DevTools Protocol.
//
// Verifies the real renderer: that every screen mounts, every button is reachable
// and labelled, clicking does not throw, and no console error or page exception
// appears. It does NOT exercise the native commands — a browser has no Tauri IPC —
// so persistence and lifecycle are covered by the Rust tests, not here.
//
// Usage: node scripts/ui-smoke.mjs   (expects a dev server on :5173 and a headless
// Chrome with --remote-debugging-port=9222). Node 22+ provides a global WebSocket,
// so this needs no dependencies.

const APP = process.env.APP_URL ?? 'http://localhost:5173/';
const failures = [];
const notes = [];

const ok = (name) => notes.push(`  ok   ${name}`);
const bad = (name, detail) => {
  failures.push(`${name}: ${detail}`);
  notes.push(`  FAIL ${name} — ${detail}`);
};

class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.exceptions = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(msg.params.exceptionDetails.exception?.description ?? 'exception');
      }
    });
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval threw');
    return r.result.value;
  }

  async goto(url) {
    await this.send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 2500));
  }
}

const snapshot = `(() => {
  const q = (s) => [...document.querySelectorAll(s)];
  return {
    h1: q('h1').map(e => e.textContent.trim()),
    buttons: q('button').map(b => ({
      text: b.textContent.trim(),
      disabled: b.disabled
    })),
    inputs: q('input, textarea, select').map(e => ({
      tag: e.tagName.toLowerCase(),
      id: e.id || null,
      label: e.labels && e.labels[0] ? e.labels[0].textContent.trim() : null,
      type: e.type || null
    })),
    unlabelledButtons: q('button').filter(b => !b.textContent.trim() && !b.getAttribute('aria-label')).length,
    alerts: q('[role=alert]').map(e => e.textContent.trim()),
    live: q('[aria-live]').map(e => e.textContent.trim()),
    text: document.body.innerText.slice(0, 300)
  };
})()`;

const clickByText = (text) => `(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(text)});
  if (!b) return 'NOT_FOUND';
  if (b.disabled) return 'DISABLED';
  b.click();
  return 'CLICKED';
})()`;

const main = async () => {
  // Chrome 111+ requires PUT for /json/new.
  const created = await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' });
  const target = await created.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  const page = new Page(ws);
  await page.send('Page.enable');
  await page.send('Runtime.enable');

  // ── Screen 1: list ────────────────────────────────────────────────
  await page.goto(APP);
  let s = await page.eval(snapshot);
  if (s.h1.length === 0) bad('list screen mounts', `no h1; body="${s.text.slice(0, 120)}"`);
  else ok(`list screen mounts (${s.h1[0]})`);
  if (s.buttons.length < 2) bad('list screen buttons', `only ${s.buttons.length} found`);
  else ok(`list screen buttons: ${s.buttons.map((b) => b.text).join(', ')}`);

  // The browser has no Tauri IPC, so the app is expected to report that clearly
  // rather than crash or hang. That is the behaviour worth asserting.
  await new Promise((r) => setTimeout(r, 1200));
  s = await page.eval(snapshot);
  if (page.exceptions.length) bad('no uncaught exception on load', page.exceptions.join(' | '));
  else ok('no uncaught exception on load');

  // ── Screen 2: preparation ─────────────────────────────────────────
  const opened = await page.eval(clickByText('New test'));
  if (opened !== 'CLICKED') bad('New test button', opened);
  else ok('New test button clicks');
  await new Promise((r) => setTimeout(r, 1200));
  s = await page.eval(snapshot);
  if (!/preparation/i.test(s.h1.join(' '))) bad('preparation screen mounts', `h1=${JSON.stringify(s.h1)}`);
  else ok(`preparation screen mounts (${s.h1[0]})`);

  const partButtons = s.buttons.filter((b) => /Part \d|Start/.test(b.text));
  if (partButtons.length === 0) bad('draft creation controls', 'no Part/Start buttons');
  else ok(`draft creation controls: ${partButtons.length} (${partButtons.slice(0, 4).map((b) => b.text).join(', ')})`);

  // ── Screen 3: a create click must not throw ───────────────────────
  if (partButtons.length > 0) {
    const before = page.exceptions.length;
    const r = await page.eval(clickByText(partButtons[0].text));
    await new Promise((res) => setTimeout(res, 1500));
    if (r === 'NOT_FOUND') bad('create draft clickable', 'button vanished');
    else if (page.exceptions.length > before) bad('create draft throws', page.exceptions.slice(before).join(' | '));
    else ok(`create draft click (${partButtons[0].text}) does not throw`);
  }


  // ── Failure path: a browser has no Tauri IPC, so a create MUST fail loudly and
  // visibly rather than silently appearing to succeed. §9 requires the UI to never
  // show a save that did not happen.
  s = await page.eval(snapshot);
  const reported = s.alerts.join(' ') || page.consoleErrors.join(' ');
  if (reported.trim() === '') bad('failed create is reported to the user', 'no alert and no error surfaced');
  else ok(`failed create is reported: "${reported.slice(0, 90)}"`);

  if (page.consoleErrors.length === 0) notes.push('  note no console error: the Tauri call may not have been attempted');

  // ── Accessibility basics the plan requires ────────────────────────
  s = await page.eval(snapshot);
  if (s.unlabelledButtons > 0) bad('buttons have accessible names', `${s.unlabelledButtons} empty button(s)`);
  else ok('every button has an accessible name');

  const unlabelledInputs = s.inputs.filter((i) => !i.label && !i.id);
  if (unlabelledInputs.length) notes.push(`  note ${unlabelledInputs.length} input(s) rely on id only (acceptable when a <label for> exists)`);

  if (page.consoleErrors.length) bad('no console errors', page.consoleErrors.slice(0, 3).join(' | '));
  else ok('no console errors');

  console.log(notes.join('\n'));
  console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}`);
  for (const f of failures) console.log(`  - ${f}`);
  ws.close();
  process.exit(failures.length === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error('smoke run failed:', e.message);
  console.error(e.stack?.split('\n').slice(0, 6).join('\n'));
  process.exit(2);
});
