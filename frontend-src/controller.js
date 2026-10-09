import { PAGE_POLL_MS, LIVE_SESSION_POLL_MS, CLOSED_SESSION_POLL_MS, NEW_PAGE_GRACE_MS,
  POINTER_MOVE_MS, FRAME_ACK_INTERVAL_MS, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, MAX_FRAME_WIDTH,
  MAX_FRAME_HEIGHT, NO_MOUSE_BUTTONS, errorText, items, normalizeUrl, validateChromePath,
  parseEvent, parseFrame, eventModifiers, mouseButton, mouseButtonMask, mouseButtonReleases,
  pageAfterClose, selectSession, selectPage, workspaceKey } from './protocol.js';
import { parseSettings, parseRuntimeDiagnostics, parseUpgrade, parseBrowserControlAcquisition } from './responses.js';
import { mountBrowserView } from './view';
async function browserMcpResult(response) {
  const text = response?.content?.find((block) => block?.type === "text")?.text;
  if (typeof text !== "string") throw new Error("浏览器 MCP 没有返回文本结果");
  const packet = JSON.parse(text);
  if (packet.error) throw new Error(packet.error.message || packet.error.code || "浏览器 MCP 调用失败");
  if (!Object.hasOwn(packet, "result")) throw new Error("浏览器 MCP 响应缺少 result");
  return packet.result;
}
async function browserTabs(host, params) { return browserMcpResult(await host.request("xsec.browser.mcp.tabs", params)); }
async function browserNavigate(host, params) { return browserMcpResult(await host.request("xsec.browser.mcp.navigate", params)); }
async function browserNavigateBack(host, params) { return browserMcpResult(await host.request("xsec.browser.mcp.navigate-back", params)); }
async function browserEvaluate(host, params) { return browserMcpResult(await host.request("xsec.browser.mcp.evaluate", params)); }
function browserRpc(host) {
  return {
    sessionsList: () => host.request("xsec.browser.sessions.list", {}),
    pagesList: (browserSessionId) => host.request("xsec.browser.pages.list", { browserSessionId }),
    createPage: async (browserSessionId, control) => { const result = await browserTabs(host, { browser_session_id: browserSessionId, action: "new", control }); return { page_id: result.current_page_id }; },
    selectPage: (browserSessionId, pageId, control) => browserTabs(host, { browser_session_id: browserSessionId, action: "select", page_id: pageId, control }),
    navigatePage: (browserSessionId, pageId, url, control) => browserNavigate(host, { browser_session_id: browserSessionId, page_id: pageId, url, control }),
    pageAction: (browserSessionId, pageId, action, control) => {
      const params = { browser_session_id: browserSessionId, page_id: pageId, control };
      if (action === "back") return browserNavigateBack(host, params);
      const source = action === "forward" ? "() => { history.forward(); return true; }" : action === "reload" ? "() => { location.reload(); return true; }" : "() => { window.stop(); return true; }";
      return browserEvaluate(host, { ...params, function: source });
    },
    closePage: (browserSessionId, pageId, control) => browserTabs(host, { browser_session_id: browserSessionId, action: "close", page_id: pageId, control }),
    openSurface: (browserSessionId, pageId) => host.request("xsec.browser.surface.open", { browserSessionId, pageId, viewportWidth: VIEWPORT_WIDTH, viewportHeight: VIEWPORT_HEIGHT }),
    readySurface: (surfaceId) => host.request("xsec.browser.surface.ready", { surfaceId }),
    controlStatus: (browserSessionId) => host.request("xsec.browser.control.status", { browserSessionId }),
    acquireControl: async (browserSessionId, takeover) => parseBrowserControlAcquisition(await host.request("xsec.browser.control.acquire", { browserSessionId, takeover }), browserSessionId),
    releaseControl: (browserSessionId, control) => host.request("xsec.browser.control.release", { browserSessionId, control }),
    sendSurfaceInput: (surfaceId, input, control) => host.request("xsec.browser.surface.input", { surfaceId, input, control }),
    closeSurface: (surfaceId) => host.request("xsec.browser.surface.close", { surfaceId }),
    acknowledgeSurface: (surfaceId, sequence) => host.request("xsec.browser.surface.presented", { surfaceId, sequence }),
    setPresentationFocus: (focus) => host.request("xsec.browser.presentation.set", { focus }),
    readSettings: () => host.request("xsec.browser.settings.get", {}),
    writeSettings: (chromePath) => host.request("xsec.browser.settings.set", { chromePath }),
    readRuntime: (browserSessionId) => host.request("xsec.browser.runtime.get", { browserSessionId }),
    runtimeDiagnostics: (browserSessionId) => host.request("xsec.browser.runtime.diagnostics", { browserSessionId }),
    upgradeSession: (browserSessionId) => host.request("xsec.browser.session.upgrade", { browserSessionId }),
    onData: (stream, callback) => host.onData(stream, callback),
  };
}
class BrowserLease {
  constructor(rpc, browserSessionId) { this.rpc = rpc; this.browserSessionId = browserSessionId; this.current = undefined; this.generation = 0; this.closing = false; this.suspended = false; this.acquisitions = new Set(); }
  get control() { return this.suspended ? undefined : this.current; }
  async status() {
    if (this.closing) throw new Error("BROWSER_SESSION_CONTROL_CLOSED");
    const status = await this.rpc.controlStatus(this.browserSessionId);
    if (this.closing) throw new Error("BROWSER_SESSION_CONTROL_CLOSED");
    if (status.generation >= this.generation) { this.generation = status.generation; this.current = status.control || undefined; this.suspended = status.operationPending; }
    return status;
  }
  async acquire(takeover) {
    if (this.closing) throw new Error("BROWSER_SESSION_CONTROL_CLOSED");
    const pending = this.rpc.acquireControl(this.browserSessionId, takeover).then((control) => { if (control.generation >= this.generation) { this.generation = control.generation; this.current = control; this.suspended = false; } return control; });
    this.acquisitions.add(pending);
    try { const control = await pending; if (this.closing) throw new Error("BROWSER_SESSION_CONTROL_CLOSED"); return control; }
    finally { this.acquisitions.delete(pending); }
  }
  async release(control) { if (this.closing) throw new Error("BROWSER_SESSION_CONTROL_CLOSED"); await this.rpc.releaseControl(this.browserSessionId, control); if (this.current?.leaseId === control.leaseId) this.current = undefined; }
  dispose() { if (this.disposal) return this.disposal; this.closing = true; this.disposal = this.releaseAcquired(); return this.disposal; }
  async releaseAcquired() {
    const results = await Promise.allSettled([...this.acquisitions]); const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (this.current) { try { await this.rpc.releaseControl(this.browserSessionId, this.current); } catch (error) { failures.push(error); } }
    this.current = undefined;
    if (failures.length) throw new AggregateError(failures, "BROWSER_SURFACE_CONTROL_RELEASE_FAILED");
  }
}
export class BrowserController {
  constructor(rpc, context, host) {
    this.host = host; this.surfaceKind = context?.kind === "settings-page";
    this.settings = { loading: true, saving: false, path: "", error: "", errorId: "", saved: false, detectedPath: null, available: false };
    this.settingsWriteOwner = 0; this.settingsReadQueued = false;
    this.runtime = { open: false, loading: false, content: "", error: "", errorId: "", upgrade: false, upgrading: false };
    this.runtimeRevision = 0; this.runtimeUpgradeOperation = undefined; this.errors = { workspace: "", surface: "", control: "" };
    this.rpc = rpc; this.context = context || {}; this.key = workspaceKey(this.context);
    this.state = { sessions: [], sessionId: null, userSelected: false, pages: [], groups: [], pageId: null, pageUrl: null, follow: true, focus: false, address: "", error: "", surfaceError: "", busy: "", loading: true, pending: null, observed: null, surfaceState: "" };
    this.timer = 0; this.revision = 0; this.refreshing = false; this.refreshQueued = false; this.refreshChain = Promise.resolve(); this.refreshLoopPromise = Promise.resolve(); this.disposed = false; this.surface = undefined; this.subscription = undefined; this.surfaceGeneration = 0; this.surfaceErrorKey = ""; this.controlBusy = false; this.controlError = ""; this.closingControl = undefined; this.lease = undefined;
    this.moveTimer = 0; this.pendingMove = undefined; this.inputTail = Promise.resolve(); this.surfaceCloseTail = Promise.resolve(); this.surfaceClosePromises = new Map(); this.orphanedSurfaces = new Map(); this.closingPages = new Set(); this.surfaceTransitionTail = Promise.resolve(); this.surfaceTeardownPromise = undefined; this.closingSurfaceId = ""; this.addressEditPageId = null; this.presentationTails = new Map(); this.sessionControlsKey = ""; this.tabControlsKey = ""; this.canvasContext = undefined; this.composing = false; this.compositionSurfaceId = ""; this.compositionCancelled = false; this.ignoredText = undefined; this.pressedKeys = new Map(); this.mouseButtons = 0; this.mouseSurfaceId = ""; this.lastPoint = { x: 0, y: 0 }; this.frameViewport = undefined; this.frameSurfaceId = ""; this.nextFrameAckAt = 0; this.focusTail = Promise.resolve(); this.focusTarget = false; this.focusRevision = 0; this.visibilityRevision = 0; this.settingsReady = false; this.settingsRevision = 0;
    this.onEscape = (event) => { if (this.focusTarget && event.key === "Escape") void this.setFocus(false).catch((error) => this.fail(error, "presentation")); };
    this.onVisibilityChange = () => void this.handleVisibilityChange(); this.onWindowBlur = () => { const modifiers = this.activeModifierMask(); this.releaseMouseButtons({ modifiers }); this.releasePressedKeys(); };
  }
  mount(root, context) {
    if (this.root || this.disposed) throw new Error("浏览器控制器已经挂载或释放");
    this.root = root; this.context = context || this.context;
    if (this.settingsPage()) return this.buildSettings();
    this.buildWorkspace(); console.debug("browser.workspace.mounted", { workspace: this.key }); void this.refresh();
  }
  async update(context) {
    if (this.disposed) throw new Error("浏览器控制器已释放");
    if ((context?.kind === "settings-page") !== this.surfaceKind) throw new Error("浏览器页面类型变化需要重新挂载");
    const visibilityRevision = ++this.visibilityRevision; const next = context || {}; const changed = workspaceKey(next) !== this.key;
    this.context = next; this.key = workspaceKey(next); if (this.settingsPage()) return this.loadSettings();
    if (changed) { this.invalidateRefresh(); this.state.userSelected = false; this.state.sessionId = null; this.state.follow = true; await this.resetPages(); }
    if (this.visible()) await this.manualRefresh();
    else await this.teardownWorkspace(visibilityRevision);
  }
  async dispose() {
    try { await this.stopBusiness(); }
    finally { this.view?.dispose(); this.view = undefined; this.controls = undefined; this.root = undefined; }
    console.debug("browser.frontend.disposed");
  }
  stopBusiness() {
    if (this.businessDisposal) return this.businessDisposal;
    this.disposed = true; this.settingsRevision++; this.settingsWriteOwner++; this.runtimeRevision++;
    this.invalidateRefresh(); this.clearTimer(); this.clearPendingMove();
    window.removeEventListener("keydown", this.onEscape); window.removeEventListener("blur", this.onWindowBlur);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.businessDisposal = this.settingsPage() ? Promise.resolve() : this.teardownWorkspace();
    return this.businessDisposal;
  }
  settingsPage() { return this.surfaceKind; }
  async showRuntimeDiagnostics() {
    const session = this.session(); if (!session || this.disposed || this.runtimeUpgradeOperation) return;
    const revision = ++this.runtimeRevision, key = this.key, operationId = crypto.randomUUID();
    const current = () => !this.disposed && revision === this.runtimeRevision && key === this.key && this.session()?.id === session.id;
    this.runtime = { ...this.runtime, open: true, loading: true, content: "", error: "", errorId: "", upgrade: false }; this.render();
    console.info("browser.diagnostics.started", { operation_id: operationId });
    try {
      const [runtime, diagnostics] = await Promise.all([this.rpc.readRuntime(session.id), this.rpc.runtimeDiagnostics(session.id)]);
      if (!current()) return;
      const value = parseRuntimeDiagnostics(runtime, diagnostics, session.id);
      this.runtime = { ...this.runtime, loading: false, content: value.content, upgrade: value.upgrade };
      console.info("browser.diagnostics.completed", { operation_id: operationId, outcome: "completed" });
    } catch (error) {
      if (!current()) return;
      this.runtime = { ...this.runtime, loading: false, error: errorText(error), errorId: operationId };
      console.error("browser.diagnostics.failed", { operation_id: operationId, outcome: "failed" });
    }
    if (current()) this.render();
  }
  closeRuntimeDiagnostics() { this.runtimeRevision++; this.runtime = { ...this.runtime, open: false, loading: false, upgrading: false }; this.render(); }
  async upgradeRuntimeSession() {
    const session = this.session(); if (!session || this.runtimeUpgradeOperation || this.disposed) return;
    const key = this.key, revision = ++this.runtimeRevision, operationId = crypto.randomUUID();
    const current = () => !this.disposed && key === this.key && revision === this.runtimeRevision && this.session()?.id === session.id;
    this.runtimeUpgradeOperation = operationId;
    this.runtime = { ...this.runtime, upgrading: true, error: "", errorId: "" }; this.render();
    console.info("browser.session.upgrade.started", { operation_id: operationId });
    try {
      const result = await this.rpc.upgradeSession(session.id);
      if (!current()) return;
      const message = parseUpgrade(result, session.id);
      this.runtime = { ...this.runtime, content: message, upgrade: false };
      console.info("browser.session.upgrade.completed", { operation_id: operationId, outcome: "completed" });
      await this.manualRefresh();
    } catch (error) {
      if (current()) { this.runtime = { ...this.runtime, error: errorText(error), errorId: operationId }; console.error("browser.session.upgrade.failed", { operation_id: operationId, outcome: "failed" }); }
    } finally {
      if (this.runtimeUpgradeOperation === operationId) this.runtimeUpgradeOperation = undefined;
      if (current()) { this.runtime = { ...this.runtime, upgrading: false }; this.render(); }
    }
  }
  binding() { return this.context.workspace?.binding || {}; }
  visible() { return !this.disposed && this.context.visible !== false && document.visibilityState !== "hidden"; }
  session() { return this.state.sessions.find((item) => item.id === this.state.sessionId) || null; }
  page() { return this.state.pages.find((item) => item.id === this.state.pageId) || null; }
  inputBusy() { return document.activeElement === this.controls?.keyboard || this.pressedKeys.size > 0 || this.mouseButtons !== NO_MOUSE_BUTTONS; }
  surfaceKey(sessionId, pageId) { return `${sessionId}:${pageId}`; }
  clearTimer() { if (this.timer) window.clearTimeout(this.timer); this.timer = 0; }
  clearPendingMove() { if (this.moveTimer) window.clearTimeout(this.moveTimer); this.moveTimer = 0; this.pendingMove = undefined; this.mouseButtons = 0; }
  clearSurfaceInput() { this.clearPendingMove(); this.mouseSurfaceId = ""; this.closingSurfaceId = ""; this.compositionCancelled ||= this.composing; this.composing = false; this.compositionSurfaceId = ""; if (this.controls?.keyboard) this.controls.keyboard.value = ""; this.pressedKeys.clear(); this.inputTail = Promise.resolve(); } activeModifierMask() { return [...this.pressedKeys.values()].reduce((mask, input) => mask | (input.modifiers || 0), 0); } releasePressedKeys() { const held = [...this.pressedKeys.values()]; this.pressedKeys.clear(); held.forEach((input) => void this.sendInput({ ...input, event_type: "up", auto_repeat: false })); }
  invalidateRefresh() { this.revision += 1; if (this.refreshing) this.refreshQueued = true; }
  schedule(delay) { this.clearTimer(); if (this.visible() && !this.state.error) this.timer = window.setTimeout(() => void this.refresh(), delay); }
  clearSurfaceError() { this.surfaceErrorKey = ""; this.state.surfaceError = ""; if (["error", "closed"].includes(this.state.surfaceState)) this.state.surfaceState = ""; }
  async teardownWorkspace(visibilityRevision) {
    const failures = [];
    try { await this.setFocus(false); } catch (error) { failures.push(error); }
    if (visibilityRevision === undefined || visibilityRevision === this.visibilityRevision && !this.visible()) {
      try { await this.closeSurface(); } catch (error) { failures.push(error); }
      try { await this.closeLease(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "BROWSER_WORKSPACE_DISPOSAL_FAILED");
  }
  async resetPages() {
    this.runtimeRevision++; this.runtime = { ...this.runtime, open: false, loading: false, upgrade: false, upgrading: false }; this.clearSurfaceError(); this.closingPages.clear(); Object.assign(this.state, { pages: [], groups: [], pageId: null, pageUrl: null, pending: null, observed: null, address: "" }); await this.closeSurface();
  }
  async handleVisibilityChange() {
    const visibilityRevision = ++this.visibilityRevision;
    if (!this.visible()) { this.clearTimer(); this.releaseMouseButtons(); this.clearPendingMove(); await this.teardownWorkspace(visibilityRevision); if (visibilityRevision === this.visibilityRevision && !this.visible()) { this.render(); console.debug("browser.workspace.hidden"); } return; }
    console.debug("browser.workspace.visible"); await this.manualRefresh();
  }
  async refresh() {
    if (this.refreshing) { this.refreshQueued = true; return this.refreshLoopPromise; }
    if (!this.visible() || this.state.error) return;
    this.refreshing = true; this.refreshQueued = false; this.refreshLoopPromise = this.runRefreshLoop(); await this.refreshLoopPromise;
  }
  async runRefreshLoop() {
    try { do { this.refreshChain = this.refreshOnce(); await this.refreshChain; if (this.refreshQueued && this.visible()) this.refreshQueued = false; else break; } while (true); } finally { this.refreshing = false; }
  }
  async refreshOnce() {
    const id = ++this.revision;
    try {
      const sessions = items(await this.rpc.sessionsList(), "浏览器会话"); if (id !== this.revision) return;
      this.state.sessions = sessions; this.state.loading = false;
      const next = selectSession(sessions, this.state.sessionId, this.binding().assignmentId || this.binding().runId, this.state.userSelected);
      if (next !== this.state.sessionId) { this.state.sessionId = next; await this.resetPages(); }
      const session = this.session();
      if (!session?.live) { await this.resetPages(); this.render(); this.schedule(sessions.some((item) => item.live) ? LIVE_SESSION_POLL_MS : CLOSED_SESSION_POLL_MS); return; }
      await this.refreshPages(session, id); if (id !== this.revision) return; this.state.error = ""; this.render(); this.schedule(PAGE_POLL_MS);
    } catch (error) { if (id === this.revision) { this.state.loading = false; this.fail(error, "sync"); } }
  }
  async refreshPages(session, revision) {
    const snapshot = await this.rpc.pagesList(session.id); if (revision !== this.revision) return;
    if (!Array.isArray(snapshot?.pages) || !Array.isArray(snapshot.groups)) throw new Error("浏览器页面响应格式无效");
    const opened = this.state.observed && this.state.pageId ? snapshot.pages.find((page) => !this.state.observed.has(page.id) && page.opener_id === this.state.pageId)?.id : null;
    this.state.observed = new Set(snapshot.pages.map((page) => page.id)); this.state.pages = snapshot.pages; this.state.groups = snapshot.groups;
    const pending = this.state.pending?.expiresAt > Date.now() ? this.state.pending.pageId : null; if (!pending || snapshot.pages.some((page) => page.id === pending)) this.state.pending = null;
    const busy = this.inputBusy(); const adoptPopup = opened && !busy;
    if (adoptPopup) this.state.follow = false; const next = selectPage(snapshot.pages, snapshot.groups, this.state.pageId, busy ? false : this.state.follow, adoptPopup ? opened : pending);
    if (next !== this.state.pageId) { this.state.pageId = next; this.clearSurfaceError(); } this.updateAddress(); await this.ensureSurface();
  }
  updateAddress(force = false) {
    const page = this.page(); const url = page?.url || null; if (url === this.state.pageUrl && !force && this.addressEditPageId === this.state.pageId) return;
    this.state.pageUrl = url; const editing = document.activeElement === this.controls?.address; const editingCurrentPage = editing && this.addressEditPageId === this.state.pageId;
    if (!editingCurrentPage) { this.state.address = url && url !== "about:blank" ? url : ""; if (editing) { this.controls.address.value = this.state.address; this.addressEditPageId = this.state.pageId; } }
  }
  async manualRefresh() {
    this.state.error = ""; this.clearTimer(); if (this.refreshing) { this.invalidateRefresh(); await this.refreshLoopPromise; return; } await this.refresh();
  }
  fail(error, stage, operationId = crypto.randomUUID()) { this.errors.workspace = operationId; console.error(`browser.${stage}.failed`, { operation_id: operationId, outcome: "failed" }); this.state.error = errorText(error); this.render(); }
  async action(name, operation) {
    const startedAt = performance.now(), operationId = crypto.randomUUID(); const scope = { key: this.key, sessionId: this.state.sessionId, pageId: this.state.pageId }; const current = () => !this.disposed && this.key === scope.key && this.state.sessionId === scope.sessionId && this.state.pageId === scope.pageId; this.state.busy = name; this.render(); console.info("browser.action.started", { operation_id: operationId, action: name });
    try { await operation(scope); if (current()) { this.state.error = ""; await this.manualRefresh(); console.info("browser.action.completed", { operation_id: operationId, action: name, outcome: "completed", elapsedMs: Math.round(performance.now() - startedAt) }); } }
    catch (error) { if (current()) this.fail(error, "action", operationId); else console.error("browser.action.stale_failed", { operation_id: operationId, action: name, outcome: "failed" }); } finally { this.state.busy = ""; if (!this.disposed) this.render(); }
  }
  async chooseSession(id) {
    this.invalidateRefresh(); this.state.userSelected = true; this.state.sessionId = id; this.state.follow = true; await this.resetPages(); console.info("browser.session.selected", { source: "user" }); await this.manualRefresh();
  }
  async choosePage(id) {
    if (this.closingPages.has(id)) return;
    const session = this.session(); if (!session?.live) return;
    if (this.surface?.controller.control) await this.rpc.selectPage(session.id, id, this.requireControl());
    this.state.pending = null; this.state.follow = false; this.state.pageId = id; this.clearSurfaceError(); this.updateAddress(); console.info("browser.page.selected", { source: "user" }); await this.ensureSurface(); this.render();
  }
  async createPage() {
    const session = this.session(); const key = this.key; if (!session?.live) return;
    await this.action("new", async (scope) => { const result = await this.rpc.createPage(session.id, this.requireControl()); if (this.key !== key || this.session()?.id !== session.id || this.state.pageId !== scope.pageId) return; this.state.pending = { pageId: result.page_id, expiresAt: Date.now() + NEW_PAGE_GRACE_MS }; this.state.follow = false; this.state.pageId = result.page_id; scope.pageId = result.page_id; this.clearSurfaceError(); });
  }
  async navigate() {
    const session = this.session(); const page = this.page(); if (!session?.live || !page) return;
    if (this.addressEditPageId && this.addressEditPageId !== page.id) { this.addressEditPageId = null; this.updateAddress(true); return; }
    const address = this.state.address; await this.action("navigate", () => this.rpc.navigatePage(session.id, page.id, normalizeUrl(address), this.requireControl()));
  }
  async pageAction(action) {
    const session = this.session(); const page = this.page(); if (!session?.live || !page) return;
    await this.action(action, () => this.rpc.pageAction(session.id, page.id, action, this.requireControl()));
  }
  async closePage(id) {
    const session = this.session(); const key = this.key; if (!session?.live || this.closingPages.has(id)) return; const next = this.state.pageId === id ? pageAfterClose(this.state.pages, id) : null;
    this.closingPages.add(id); this.render();
    try {
      await this.action("close", async (scope) => {
        const control = this.requireControl();
        if (this.surface?.pageId === id) await this.closeSurface();
        await this.rpc.closePage(session.id, id, control);
        if (this.key !== key || this.session()?.id !== session.id) return;
        if (next && this.state.pageId === id) { this.state.follow = false; this.state.pageId = next; this.clearSurfaceError(); this.updateAddress(); }
        scope.key = this.key; scope.sessionId = this.state.sessionId; scope.pageId = this.state.pageId;
      });
    } finally { this.closingPages.delete(id); if (!this.disposed) this.render(); }
  }
  async closeSurface(clearState = true, invalidate = true) { if (this.surfaceTeardownPromise) return this.surfaceTeardownPromise; this.surfaceTeardownPromise = this.closeSurfaceNow(clearState, invalidate).finally(() => { this.surfaceTeardownPromise = undefined; }); return this.surfaceTeardownPromise;
  } async closeSurfaceNow(clearState = true, invalidate = true) {
    const surface = this.surface; const subscription = this.subscription; const controller = surface?.controller; const control = controller?.control;
    const heldKeys = [...this.pressedKeys.values()]; const heldModifiers = this.activeModifierMask(); this.pressedKeys.clear();
    this.closingSurfaceId = this.mouseSurfaceId || surface?.id || ""; this.closingControl = control;
    const release = this.releaseMouseButtons({ modifiers: heldModifiers, propagate: true }); this.surface = undefined; this.subscription = undefined;
    if (invalidate) this.surfaceGeneration += 1; this.frameViewport = undefined; this.frameSurfaceId = ""; if (this.controls?.canvas) this.controls.canvas.hidden = true;
    const releaseKeys = async () => { if (control) for (const input of heldKeys) await this.rpc.sendSurfaceInput(surface.id, { ...input, event_type: "up", auto_repeat: false }, control); };
    const keyRelease = surface ? this.inputTail.then(releaseKeys, releaseKeys) : Promise.resolve();
    const results = await Promise.allSettled([keyRelease, release]); this.clearSurfaceInput(); subscription?.dispose?.(); if (clearState) this.state.surfaceState = "";
    const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
    try { await this.closeNativeSurface(surface); } catch (error) { failures.push(error); }
    this.closingControl = undefined; if (failures.length) throw new AggregateError(failures, "BROWSER_SURFACE_DISPOSAL_FAILED");
  } closeNativeSurface(surface) { if (!surface) return this.surfaceCloseTail; const existing = this.surfaceClosePromises.get(surface.id); if (existing) return existing; const close = async () => { console.debug("browser.surface.close.started", { pageId: surface.pageId }); await this.rpc.closeSurface(surface.id); }; const operation = this.surfaceCloseTail.then(close, close); const presentation = this.presentationTails.get(surface.id); this.surfaceClosePromises.set(surface.id, operation); void operation.then(() => { this.orphanedSurfaces.delete(surface.id); this.clearSurfaceTails(surface.id, operation, presentation); }, () => { this.orphanedSurfaces.set(surface.id, { id: surface.id, pageId: surface.pageId }); this.clearSurfaceTails(surface.id, operation, presentation); }); this.surfaceCloseTail = operation.catch((error) => console.error("browser.surface.close.failed", { message: errorText(error) })); return operation; }
  clearSurfaceTails(surfaceId, operation, presentation) { if (this.surfaceClosePromises.get(surfaceId) === operation) this.surfaceClosePromises.delete(surfaceId); if (this.presentationTails.get(surfaceId) === presentation) this.presentationTails.delete(surfaceId); }
  async closeLease() {
    const controller = this.lease;
    this.lease = undefined;
    if (controller) await controller.dispose();
  }
  async closeOrphanedSurfaces() { const results = await Promise.allSettled([...this.orphanedSurfaces.values()].map((surface) => this.closeNativeSurface(surface))); const failure = results.find((result) => result.status === "rejected"); if (failure) throw failure.reason; }
  surfaceRequestCurrent(generation, sessionId, pageId) { return generation === this.surfaceGeneration && this.visible() && !this.closingPages.has(pageId) && this.session()?.id === sessionId && this.page()?.id === pageId; }
  async ensureSurface() { const run = () => this.ensureSurfaceNow(); this.surfaceTransitionTail = this.surfaceTransitionTail.then(run, run); return this.surfaceTransitionTail; } async ensureSurfaceNow() {
    const session = this.session(); const page = this.page();
    if (!this.visible() || !session?.live) { await this.closeSurface(); await this.closeLease(); return; }
    if (this.lease?.browserSessionId !== session.id) {
      await this.closeSurface(); await this.closeLease();
      this.lease = new BrowserLease(this.rpc, session.id);
      await this.lease.status(); this.render();
    }
    if (!page) { await this.closeSurface(); return; }
    if (this.closingPages.has(page.id)) return;
    const key = this.surfaceKey(session.id, page.id); if (this.surface?.pageId === page.id && this.surface.sessionId === session.id) return; if (this.surfaceErrorKey === key) return;
    const generation = ++this.surfaceGeneration; await this.closeSurface(true, false); if (generation !== this.surfaceGeneration) return; this.state.surfaceState = "connecting"; this.state.surfaceError = ""; this.render(); console.info("browser.surface.open.started", { pageId: page.id });
    try {
      const result = await this.rpc.openSurface(session.id, page.id);
      if (!this.surfaceRequestCurrent(generation, session.id, page.id)) { await this.closeNativeSurface({ id: result.surfaceId, pageId: page.id }); return; }
      this.surface = { id: result.surfaceId, stream: result.stream, pageId: page.id, sessionId: session.id, controller: this.lease }; this.controlError = ""; this.nextFrameAckAt = 0;
      this.subscription = this.rpc.onData(result.stream, (raw) => { const tail = this.presentationTails.get(result.surfaceId) || Promise.resolve(); const next = tail.then(() => this.present(raw, result.surfaceId), () => this.present(raw, result.surfaceId)).catch((error) => this.failSurface(error, result.surfaceId)); this.presentationTails.set(result.surfaceId, next); void next.then(() => this.clearPresentationTail(result.surfaceId, next), () => this.clearPresentationTail(result.surfaceId, next)); });
      await this.rpc.readySurface(result.surfaceId);
      if (!this.surfaceRequestCurrent(generation, session.id, page.id) || this.surface?.id !== result.surfaceId) {
        const stale = this.surface?.id === result.surfaceId ? this.surface : undefined;
        if (stale) { this.surface = undefined; this.subscription?.dispose?.(); this.subscription = undefined; this.frameViewport = undefined; this.frameSurfaceId = ""; this.clearSurfaceInput(); }
        const teardown = this.surfaceTeardownPromise;
        if (teardown) await teardown;
        else await this.closeNativeSurface(stale || { id: result.surfaceId, pageId: page.id });
        return;
      }
      await this.surface.controller.status(); this.render(); console.info("browser.surface.open.completed", { pageId: page.id });
    } catch (error) { if (generation !== this.surfaceGeneration || this.session()?.id !== session.id || this.page()?.id !== page.id) return; await this.failSurface(error, undefined, generation); }
  }
  async retrySurface() { await this.closeOrphanedSurfaces(); this.clearSurfaceError(); await this.ensureSurface(); }
  async acknowledgeFrame(surfaceId, sequence) {
    const delay = Math.max(0, this.nextFrameAckAt - performance.now()); if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
    if (this.surface?.id !== surfaceId) return; this.nextFrameAckAt = performance.now() + FRAME_ACK_INTERVAL_MS; await this.rpc.acknowledgeSurface(surfaceId, sequence);
  }
  async present(raw, surfaceId) {
    if (!this.controls || this.surface?.id !== surfaceId) return; const event = parseEvent(raw);
    if (event) { await this.presentEvent(event, surfaceId); return; }
    const frame = parseFrame(raw); if (!frame) throw new Error("未知的浏览器画面数据"); await this.presentFrame(frame, surfaceId);
  }
  clearPresentationTail(surfaceId, tail) { if (this.presentationTails.get(surfaceId) === tail) this.presentationTails.delete(surfaceId); }
  async presentEvent(event, surfaceId) {
    if (event.kind === "error") throw new Error(event.message || "真实浏览器画面不可用");
    if (event.kind === "closed") { const surface = this.surface; if (!surface || surface.id !== surfaceId) return; this.subscription?.dispose?.(); this.subscription = undefined; this.surface = undefined; this.frameViewport = undefined; this.frameSurfaceId = ""; this.clearSurfaceInput(); this.surfaceErrorKey = this.surfaceKey(surface.sessionId, surface.pageId); this.state.surfaceState = "closed"; this.render(); return; }
    if (this.state.surfaceState !== "live") { this.state.surfaceState = "live"; this.render(); }
  }
  async presentFrame(frame, surfaceId) {
    const image = await createImageBitmap(new Blob([frame.jpeg], { type: "image/jpeg" }));
    try {
      if (this.surface?.id !== surfaceId) return;
      if (image.width > MAX_FRAME_WIDTH || image.height > MAX_FRAME_HEIGHT) throw new Error("浏览器画面 JPEG 尺寸超出限制");
      const firstFrame = this.frameSurfaceId !== surfaceId; const canvas = this.controls.canvas; if (canvas.width !== image.width) canvas.width = image.width; if (canvas.height !== image.height) canvas.height = image.height; this.canvasContext ||= canvas.getContext("2d", { alpha: false }); if (!this.canvasContext) throw new Error("浏览器画布绘制上下文不可用"); this.canvasContext.drawImage(image, 0, 0); this.frameViewport = { width: frame.width, height: frame.height }; this.frameSurfaceId = surfaceId;
      if (firstFrame || this.state.surfaceState !== "live") { this.state.surfaceState = "live"; this.render(); }
    } finally { image.close(); }
    await this.acknowledgeFrame(surfaceId, frame.sequence);
  }
  async failSurface(error, surfaceId, generation) {
    if (generation !== undefined && generation !== this.surfaceGeneration) return; const surface = this.surface; if (surfaceId && surface?.id !== surfaceId) return;
    const key = surface ? this.surfaceKey(surface.sessionId, surface.pageId) : this.surfaceKey(this.state.sessionId, this.state.pageId); const current = !surface || surface.sessionId === this.state.sessionId && surface.pageId === this.state.pageId; this.surfaceErrorKey = key; this.errors.surface = crypto.randomUUID(); console.error("browser.surface.failed", { operation_id: this.errors.surface, outcome: "failed" });
    if (current) { this.state.surfaceState = "error"; this.state.surfaceError = errorText(error); this.frameViewport = undefined; this.frameSurfaceId = ""; this.render(); } if (surface) await this.closeSurface(false);
  }
  async setFocus(focus) {
    this.focusTarget = focus; const revision = ++this.focusRevision;
    const apply = async () => { try { await this.rpc.setPresentationFocus(focus); this.state.focus = focus; if (revision === this.focusRevision) this.render(); } catch (error) { if (revision !== this.focusRevision) return; this.focusTarget = this.state.focus; throw error; } };
    this.focusTail = this.focusTail.then(apply, apply); return this.focusTail;
  }
  releaseMouseButtons(options = {}) { const buttons = this.mouseButtons; const surfaceId = this.mouseSurfaceId || this.surface?.id; const move = this.takePendingMove(); const modifiers = options.modifiers ?? this.activeModifierMask(); this.mouseButtons = 0; this.mouseSurfaceId = ""; if (!buttons || !surfaceId) return Promise.resolve(); return this.queuePointer(surfaceId, [...(move ? [move] : []), ...mouseButtonReleases(buttons, this.lastPoint, modifiers)], options); }
  requireControl() {
    const control = this.lease?.control;
    if (!control || control.kind !== "browser" || control.resourceId !== this.session()?.id) throw new Error("BROWSER_CONTROL_REQUIRED");
    return control;
  }
  async changeControl(takeover) {
    const controller = this.lease; if (!controller || controller.browserSessionId !== this.session()?.id || this.controlBusy) return; this.controlBusy = true; this.controlError = ""; this.render();
    try {
      if (takeover === null) { const control = this.requireControl(); await this.releasePressedKeys(); await this.releaseMouseButtons({ propagate: true }); await this.inputTail; await controller.release(control); }
      else await controller.acquire(takeover);
      console.info("browser.control.changed", { action: takeover === null ? "release" : takeover ? "takeover" : "acquire" });
    } catch (error) { if (this.lease === controller) { controller.suspended = true; this.controlError = errorText(error); this.errors.control = crypto.randomUUID(); this.clearSurfaceInput(); console.error("browser.control.failed", { operation_id: this.errors.control, outcome: "failed" }); } }
    finally { if (this.lease === controller) { this.controlBusy = false; this.render(); } }
  }
  controlFailed(error, surfaceId, leaseId) {
    const surface = this.surface; if (surface?.id !== surfaceId || surface.controller.current?.leaseId !== leaseId) return;
    surface.controller.suspended = true; this.controlError = errorText(error); this.errors.control = crypto.randomUUID(); this.clearSurfaceInput(); this.render();
    console.error("browser.control.input.failed", { operation_id: this.errors.control, outcome: "failed" });
  }
  sendInput(input, surfaceId = this.surface?.id, options = {}) {
    const control = this.surface?.id === surfaceId ? this.surface.controller.control : this.closingSurfaceId === surfaceId ? this.closingControl : undefined;
    if (!surfaceId || !control) return Promise.resolve();
    const send = async () => {
      if (this.surface?.id !== surfaceId && this.closingSurfaceId !== surfaceId) return;
      if (this.surface?.id === surfaceId && this.surface.controller.control?.leaseId !== control.leaseId) return;
      try { await this.rpc.sendSurfaceInput(surfaceId, input, control); }
      catch (error) { this.controlFailed(error, surfaceId, control.leaseId); throw error; }
    };
    this.inputTail = this.inputTail.then(send, send); return this.inputTail;
  }
  point(event) {
    const rect = this.controls.canvas.getBoundingClientRect(); const width = this.frameViewport?.width || VIEWPORT_WIDTH; const height = this.frameViewport?.height || VIEWPORT_HEIGHT;
    const point = { x: Math.max(0, Math.min(width, ((event.clientX - rect.left) / rect.width) * width)), y: Math.max(0, Math.min(height, ((event.clientY - rect.top) / rect.height) * height)) }; this.lastPoint = point; return point;
  }
  takePendingMove() { if (this.moveTimer) window.clearTimeout(this.moveTimer); this.moveTimer = 0; const input = this.pendingMove; this.pendingMove = undefined; return input; }
  queuePointer(surfaceId, inputs, options = {}) { let tail = Promise.resolve(); inputs.forEach((input) => { tail = this.sendInput(input, surfaceId, options); }); return tail; }
  queueMove(input) { this.pendingMove = input; if (this.moveTimer) return; this.moveTimer = window.setTimeout(() => void this.flushPendingMove(), POINTER_MOVE_MS); }
  async flushPendingMove() { const input = this.takePendingMove(); if (input) await this.queuePointer(this.surface?.id, [input]); }
  render() { if (!this.disposed) this.view?.update(); }
  bindSurface(canvas, keyboard, address) {
    this.controls = { canvas, keyboard, address };
    bindSurfaceInput(this, canvas, keyboard);
  }
  buildWorkspace() {
    this.view = mountBrowserView(this.root, this, this.host);
    if (this.disposed) return;
    window.addEventListener("keydown", this.onEscape);
    window.addEventListener("blur", this.onWindowBlur);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.render();
  }
  buildSettings() { this.view = mountBrowserView(this.root, this, this.host); return this.loadSettings(); }
  editSettings(path) { if (this.disposed || this.settings.saving || this.settings.loading) return; this.settings = { ...this.settings, path, error: "", errorId: "", saved: false }; this.render(); }
  async loadSettings() {
    if (this.disposed) return;
    if (this.settings.saving) { this.settingsReadQueued = true; this.settingsRevision++; return; }
    const revision = ++this.settingsRevision, operationId = crypto.randomUUID(); this.settingsReady = false;
    this.settings = { ...this.settings, loading: true, error: "", errorId: "", saved: false }; this.render();
    try {
      const result = parseSettings(await this.rpc.readSettings());
      if (this.disposed || revision !== this.settingsRevision) return;
      this.settingsReady = true; this.settings = { ...this.settings, ...result, path: result.chromePath, loading: false };
      console.info("browser.settings.read.completed", { operation_id: operationId, outcome: "completed" });
    } catch (error) {
      if (this.disposed || revision !== this.settingsRevision) return;
      this.settings = { ...this.settings, loading: false, error: errorText(error), errorId: operationId };
      console.error("browser.settings.read.failed", { operation_id: operationId, outcome: "failed" });
    }
    this.render();
  }
  async saveSettings() {
    if (this.disposed || !this.settingsReady || this.settings.saving) return;
    const operationId = crypto.randomUUID(); let chromePath;
    try { chromePath = validateChromePath(this.settings.path); }
    catch (error) { this.settings = { ...this.settings, error: errorText(error), errorId: operationId, saved: false }; console.error("browser.settings.validation.failed", { operation_id: operationId, outcome: "failed" }); this.render(); return; }
    const revision = this.settingsRevision, owner = ++this.settingsWriteOwner;
    this.settings = { ...this.settings, saving: true, saved: false, error: "", errorId: "" }; this.render();
    console.info("browser.settings.save.started", { operation_id: operationId });
    try {
      const acknowledgement = parseSettings(await this.rpc.writeSettings(chromePath));
      if (acknowledgement.chromePath !== chromePath) throw new Error("浏览器路径写入回执不一致");
      if (this.disposed || revision !== this.settingsRevision) return;
      const result = parseSettings(await this.rpc.readSettings());
      if (this.disposed || revision !== this.settingsRevision) return;
      if (result.chromePath !== chromePath) throw new Error("浏览器路径持久值读回不一致");
      this.settings = { ...this.settings, ...result, path: result.chromePath, saved: true };
      console.info("browser.settings.save.completed", { operation_id: operationId, outcome: "completed" });
    } catch (error) {
      if (!this.disposed && revision === this.settingsRevision) {
        this.settings = { ...this.settings, error: errorText(error), errorId: operationId };
        console.error("browser.settings.save.failed", { operation_id: operationId, outcome: "failed" });
      }
    } finally {
      if (!this.disposed && owner === this.settingsWriteOwner) {
        this.settings = { ...this.settings, saving: false }; this.render();
        if (this.settingsReadQueued) { this.settingsReadQueued = false; await this.loadSettings(); }
      }
    }
  }
}
function bindSurfaceInput(controller, canvas, keyboard) {
  canvas.oncontextmenu = (event) => event.preventDefault();
  const pressMouse = (event, capture, clickCount) => { const mask = mouseButtonMask(event.button); const surfaceId = controller.surface?.id; if (!mask || !surfaceId || controller.mouseButtons & mask) return; event.preventDefault(); const move = controller.takePendingMove(); controller.mouseButtons = event.buttons; controller.mouseSurfaceId = surfaceId; if (capture) canvas.setPointerCapture(event.pointerId); keyboard.focus({ preventScroll: true }); const point = controller.point(event); void controller.queuePointer(surfaceId, [...(move ? [move] : []), { kind: "mouse", event_type: "down", ...point, button: mouseButton(event.button), buttons: event.buttons, click_count: clickCount, modifiers: eventModifiers(event) }]); };
  canvas.onpointerdown = (event) => { if (event.pointerType === "mouse") { canvas.setPointerCapture(event.pointerId); keyboard.focus({ preventScroll: true }); return; } pressMouse(event, true, event.detail || 1); }; canvas.onmousedown = (event) => pressMouse(event, false, event.detail || 1);
  const releaseMouse = async (event) => { const mask = mouseButtonMask(event.button); if (!mask || !(controller.mouseButtons & mask)) return; const move = controller.takePendingMove(); const surfaceId = controller.mouseSurfaceId; controller.mouseButtons = event.buttons; if (!event.buttons) controller.mouseSurfaceId = ""; const point = controller.point(event); await controller.queuePointer(surfaceId, [...(move ? [move] : []), { kind: "mouse", event_type: "up", ...point, button: mouseButton(event.button), buttons: event.buttons, click_count: event.detail || 1, modifiers: eventModifiers(event) }]); };
  canvas.onmouseup = (event) => void releaseMouse(event); canvas.onpointercancel = (event) => { const buttons = controller.mouseButtons; const move = controller.takePendingMove(); const surfaceId = controller.mouseSurfaceId; controller.mouseButtons = NO_MOUSE_BUTTONS; controller.mouseSurfaceId = ""; if (!buttons) return; const point = controller.point(event); void controller.queuePointer(surfaceId, [...(move ? [move] : []), ...mouseButtonReleases(buttons, point, eventModifiers(event))]); };
  canvas.onpointermove = (event) => { if (event.buttons && event.buttons !== controller.mouseButtons) return; const point = controller.point(event); controller.queueMove({ kind: "mouse", event_type: "move", ...point, button: "none", buttons: event.buttons, modifiers: eventModifiers(event) }); }; canvas.onlostpointercapture = () => controller.releaseMouseButtons();
  canvas.onwheel = (event) => { event.preventDefault(); const move = controller.takePendingMove(); const point = controller.point(event); void controller.queuePointer(controller.surface?.id, [...(move ? [move] : []), { kind: "mouse", event_type: "wheel", ...point, button: "none", buttons: event.buttons || controller.mouseButtons, modifiers: eventModifiers(event), delta_x: event.deltaX, delta_y: event.deltaY }]); };
  keyboard.onkeydown = (event) => { if (event.isComposing || controller.composing || event.key === "Process") return; if (!controller.surface) return; if (controller.focusTarget && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); void controller.setFocus(false).catch((error) => controller.fail(error, "presentation")); return; } const paste = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v" || event.shiftKey && event.key === "Insert"; if (paste) return; const altGraph = event.getModifierState?.("AltGraph"); const printable = event.key.length === 1 && !event.metaKey && (!event.ctrlKey && !event.altKey || altGraph || event.altKey && !event.ctrlKey); if (!printable) event.preventDefault(); const key = event.code || event.key; const input = { kind: "key", event_type: "down", key: event.key, code: event.code, modifiers: eventModifiers(event), windows_virtual_key_code: event.keyCode, auto_repeat: event.repeat }; controller.pressedKeys.set(key, input); void controller.sendInput(input); };
  keyboard.onkeyup = (event) => { const key = event.code || event.key; if (!controller.pressedKeys.delete(key)) return; void controller.sendInput({ kind: "key", event_type: "up", key: event.key, code: event.code, modifiers: eventModifiers(event), windows_virtual_key_code: event.keyCode, auto_repeat: event.repeat }); };
  keyboard.onblur = () => controller.releasePressedKeys();
  keyboard.oncompositionstart = () => { controller.composing = true; controller.compositionCancelled = false; controller.compositionSurfaceId = controller.surface?.id || ""; }; keyboard.oncompositionend = (event) => { const accepted = !controller.compositionCancelled && controller.surface?.id === controller.compositionSurfaceId; controller.composing = false; controller.compositionCancelled = false; controller.compositionSurfaceId = ""; controller.ignoredText = event.data; if (accepted && event.data) controller.sendInput({ kind: "insert_text", text: event.data }); event.target.value = ""; };
  keyboard.onpaste = (event) => { event.preventDefault(); const text = event.clipboardData.getData("text/plain"); if (text) controller.sendInput({ kind: "insert_text", text }); event.target.value = ""; };
  keyboard.oninput = (event) => { if (controller.composing) return; const text = event.target.value; event.target.value = ""; if (controller.ignoredText === text) { controller.ignoredText = undefined; return; } controller.ignoredText = undefined; if (text) controller.sendInput({ kind: "insert_text", text }); };
}

export { browserRpc };
