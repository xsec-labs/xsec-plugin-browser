import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import ts from 'typescript';
import {
  parseFrame, parseEvent, jpegDimensions, normalizeUrl, validateChromePath,
  selectSession, selectPage, pageAfterClose, mouseButtonReleases, eventModifiers,
} from '../frontend-src/protocol.js';

// Exercise pure boundary parsers directly.
const source = await readFile(new URL('../frontend-src/responses.ts', import.meta.url), 'utf8');
const emitted = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { parseSettings, parseRuntimeDiagnostics, parseUpgrade, parseBrowserControlAcquisition } = await import('data:text/javascript;base64,' + Buffer.from(emitted).toString('base64'));
const jpeg = await readFile(new URL('./fixtures/chromium-page.jpg', import.meta.url));
const evidence = JSON.parse(await readFile(new URL('./fixtures/chromium-page.json', import.meta.url), 'utf8'));
assert.equal(createHash('sha256').update(jpeg).digest('hex'), evidence.sha256);
function frame(sequence = 23, width = evidence.width, height = evidence.height, image = jpeg) {
  const bytes = new Uint8Array(16 + image.length);
  bytes.set(new TextEncoder().encode('XSBF'));
  const view = new DataView(bytes.buffer);
  view.setUint32(4, sequence, true); view.setUint32(8, width, true); view.setUint32(12, height, true);
  bytes.set(image, 16); return bytes.buffer;
}
function event(body) {
  return new TextEncoder().encode('XSBE' + JSON.stringify(body)).buffer;
}
test('Chromium JPEG frame preserves bytes, viewport and exact sequence', () => {
  assert.deepEqual(jpegDimensions(jpeg), { width: evidence.width, height: evidence.height });
  const result = parseFrame(frame());
  assert.equal(result.sequence, 23); assert.equal(result.width, evidence.width); assert.equal(result.height, evidence.height);
  assert.deepEqual(new Uint8Array(result.jpeg), new Uint8Array(jpeg));
  assert.equal(parseFrame(frame(0xffffffff)).sequence, 0xffffffff);
});
test('frame header, dimensions, sequence and byte budget reject malformed input', () => {
  assert.equal(parseFrame(new TextEncoder().encode('other').buffer), undefined);
  assert.throws(() => parseFrame(new TextEncoder().encode('XSBF').buffer), /帧无效/);
  assert.throws(() => parseFrame(frame(0)), /序号无效/);
  assert.throws(() => parseFrame(frame(1, 0)), /尺寸无效/);
  assert.throws(() => parseFrame(frame(1, 5121)), /尺寸超出限制/);
  assert.throws(() => parseFrame(frame(1, 1, 3201)), /尺寸超出限制/);
  assert.throws(() => parseFrame(frame(1, 1, 1, new Uint8Array(8 * 1024 * 1024 + 1))), /数据过大/);
});
test('JPEG parsing rejects missing signatures, truncated segments and excessive dimensions', () => {
  assert.throws(() => jpegDimensions(new Uint8Array([0, 1, 2, 3])), /JPEG 无效/);
  assert.throws(() => jpegDimensions(jpeg.subarray(0, 20)), /JPEG/);
  assert.throws(() => parseFrame(frame(1, 1, 1, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))), /缺少尺寸/);
  const oversized = Uint8Array.from(jpeg);
  for (let i = 2; i + 8 < oversized.length; i++) {
    if (oversized[i] === 0xff && [0xc0, 0xc2].includes(oversized[i + 1])) {
      oversized[i + 7] = 0xff; oversized[i + 8] = 0xff; break;
    }
  }
  assert.throws(() => jpegDimensions(oversized), /尺寸超出限制/);
});
test('stream events distinguish lifecycle packets from frames and reject invalid events', () => {
  for (const kind of ['started', 'closed', 'error']) assert.equal(parseEvent(event({ kind })).kind, kind);
  assert.equal(parseEvent(frame()), undefined);
  assert.throws(() => parseEvent(new TextEncoder().encode('XSBE').buffer), /事件无效/);
  assert.throws(() => parseEvent(event({ kind: 'unknown' })), /事件无效/);
  assert.throws(() => parseEvent(new TextEncoder().encode('XSBE{').buffer), SyntaxError);
});
test('navigation normalization accepts HTTP/S and rejects executable or local schemes', () => {
  assert.equal(normalizeUrl(' localhost:8000/path '), 'https://localhost:8000/path');
  assert.equal(normalizeUrl('http://127.0.0.1:8123/path'), 'http://127.0.0.1:8123/path');
  assert.equal(normalizeUrl('example.org'), 'https://example.org/');
  for (const url of ['', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hello']) assert.throws(() => normalizeUrl(url));
});
test('Chrome paths honor supported absolute forms and reject network or control input', () => {
  for (const path of ['', '/usr/bin/chromium', 'C:\\Program Files\\Chrome\\chrome.exe', '\\\\?\\C:\\Chrome\\chrome.exe']) assert.equal(validateChromePath(path), path);
  for (const path of ['chrome.exe', '\\\\server\\share\\chrome.exe', '\\\\?\\UNC\\server\\chrome.exe', '/bin/chrome\nother', '/bin/chrome\0']) assert.throws(() => validateChromePath(path));
});
test('session selection preserves explicit user choice and follows the current task otherwise', () => {
  const sessions = [{ id: 'ended', live: false }, { id: 'current', live: true, run_id: 'task' }, { id: 'other', live: true }];
  assert.equal(selectSession(sessions, 'ended', 'task', true), 'ended');
  assert.equal(selectSession(sessions, 'ended', 'task', false), 'current');
  assert.equal(selectSession(sessions, null, null, false), 'current');
  assert.equal(selectSession([], null, null, false), null);
});
test('page selection handles pending pages, parent groups, removal and user focus', () => {
  const pages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const groups = [{ owner: 'parent', current_page_id: 'b', updated_at: 1 }, { owner: 'parent', current_page_id: 'c', updated_at: 2 }];
  assert.equal(selectPage(pages, groups, 'a', true, null), 'c');
  assert.equal(selectPage(pages, groups, 'a', false, null), 'a');
  assert.equal(selectPage(pages, groups, 'a', true, 'pending'), 'pending');
  assert.equal(selectPage([], groups, 'a', false, null), null);
  assert.equal(pageAfterClose(pages, 'b'), 'c'); assert.equal(pageAfterClose(pages, 'c'), 'b');
  assert.equal(pageAfterClose([{ id: 'a' }], 'a'), null);
});
test('input modifiers and mouse releases preserve every held button and release order', () => {
  assert.equal(eventModifiers({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true }), 15);
  const release = mouseButtonReleases(31, { x: 12, y: 20 }, 9);
  assert.deepEqual(release.map(input => input.button), ['left', 'middle', 'right', 'back', 'forward']);
  assert.deepEqual(release.map(input => input.buttons), [30, 26, 24, 16, 0]);
  assert.ok(release.every(input => input.event_type === 'up' && input.modifiers === 9 && input.x === 12 && input.y === 20));
  assert.deepEqual(mouseButtonReleases(0, { x: 0, y: 0 }, 0), []);
});
test('settings parser enforces path, detection and availability agreement', () => {
  assert.deepEqual(parseSettings({ chromePath: '', detectedPath: null, available: false }), { chromePath: '', detectedPath: null, available: false });
  for (const value of [null, [], {}, { chromePath: '\0', detectedPath: null, available: false }, { chromePath: '', detectedPath: null, available: true }, { chromePath: '', detectedPath: 1, available: false }]) assert.throws(() => parseSettings(value));
  assert.deepEqual(parseSettings({ chromePath: '/opt/chrome', detectedPath: '/usr/bin/chromium', available: true }), { chromePath: '/opt/chrome', detectedPath: '/usr/bin/chromium', available: true });
  for (const detectedPath of ['', '/bin/chrome\nother', '/bin/chrome\0', 'x'.repeat(32769)]) assert.throws(() => parseSettings({ chromePath: '', detectedPath, available: true }), /自动发现路径/);
});
test('runtime parser rejects malformed and cross-session boundaries before display', () => {
  // Verify schema and ownership before rendering diagnostic content.
  const runtime = { pluginId: 'com.xsec.workspace.browser', contractVersion: 3, settings: { chromePath: '', detectedPath: null, available: false }, session: { browserSessionId: 'session-a', contractVersion: 3, status: 'open', engineOwner: 'plugin', runtimeMode: 'hosted' } };
  const diagnostics = { runtime, chrome: null, node: null, proxy: 'Runtime-managed in hosted mode', bridge: 'sidecar-managed' };
  assert.equal(parseRuntimeDiagnostics(runtime, diagnostics, 'session-a').upgrade, false);
  assert.throws(() => parseRuntimeDiagnostics(runtime, diagnostics, 'session-b'), /归属无效/);
  assert.throws(() => parseRuntimeDiagnostics(runtime, { ...diagnostics, runtime: { ...runtime, pluginId: 'other' } }, 'session-a'), /契约无效/);
  assert.throws(() => parseRuntimeDiagnostics({ ...runtime, session: { ...runtime.session, runtimeMode: null } }, diagnostics, 'session-a'), /运行模式/);
  assert.throws(() => parseRuntimeDiagnostics(runtime, { ...diagnostics, node: 1 }, 'session-a'), /Node/);
  assert.throws(() => parseRuntimeDiagnostics(runtime, { ...diagnostics, chrome: {} }, 'session-a'), /Chrome/);
});
test('legacy upgrade parser requires the closed legacy owner and explicit v3 creation contract', () => {
  const input = { upgraded: false, legacyBrowserSessionId: 'legacy-a', action: 'create_v3_session', contractVersion: 3, stateTransferred: false, message: 'Create a new v3 session.' };
  assert.equal(parseUpgrade(input, 'legacy-a'), input.message);
  for (const value of [{ ...input, upgraded: true }, { ...input, stateTransferred: true }, { ...input, contractVersion: 2 }, { ...input, message: null }]) assert.throws(() => parseUpgrade(value, 'legacy-a'));
  assert.throws(() => parseUpgrade(input, 'legacy-b'), /契约无效/);
});
test('real Host control envelope preserves the acquired browser lease', async () => {
  const observed = JSON.parse(await readFile(new URL('./fixtures/browser-control.json', import.meta.url), 'utf8'));
  assert.equal(observed.provenance.outcome, 'success');
  assert.deepEqual(parseBrowserControlAcquisition(observed.response, observed.browserSessionId), observed.response.control);
  assert.throws(() => parseBrowserControlAcquisition(observed.response.control, observed.browserSessionId), /响应结构/);
  assert.throws(() => parseBrowserControlAcquisition(observed.response, 'another-browser-session'), /归属/);
  for (const patch of [{ version: 2 }, { kind: 'terminal' }, { epoch: 0 }, { generation: 0 }, { generation: 1.5 }, { clientId: 'invalid' }, { instanceId: null }, { leaseId: '' }, { accountContext: '' }, { extra: true }]) {
    assert.throws(() => parseBrowserControlAcquisition({ control: { ...observed.response.control, ...patch } }, observed.browserSessionId));
  }
  for (const field of Object.keys(observed.response.control)) {
    const incomplete = { ...observed.response.control }; delete incomplete[field];
    assert.throws(() => parseBrowserControlAcquisition({ control: incomplete }, observed.browserSessionId));
  }
});
