function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}响应无效`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string) {
  if (typeof value !== 'string') throw new Error(`${label}必须是文本`);
  return value;
}
export function parseBrowserControlAcquisition(value: unknown, browserSessionId: string) {
  const response = record(value, '浏览器控制权');
  if (Object.keys(response).length !== 1 || !Object.hasOwn(response, 'control')) throw new Error('浏览器控制权响应结构无效');
  const control = record(response.control, '浏览器控制租约');
  const fields = ['version', 'instanceId', 'accountContext', 'epoch', 'kind', 'resourceId', 'clientId', 'leaseId', 'generation'];
  if (Object.keys(control).length !== fields.length || Object.keys(control).some(key => !fields.includes(key)) ||
    control.version !== 1 || control.kind !== 'browser' || control.resourceId !== browserSessionId ||
    !Number.isSafeInteger(control.epoch) || Number(control.epoch) < 1 ||
    !Number.isSafeInteger(control.generation) || Number(control.generation) < 1) throw new Error('浏览器控制租约归属或版本无效');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const instanceId = text(control.instanceId, '运行端实例'), clientId = text(control.clientId, '控制客户端'), leaseId = text(control.leaseId, '控制租约');
  const accountContext = text(control.accountContext, '账户上下文');
  if (!uuid.test(instanceId) || !uuid.test(clientId) || !uuid.test(leaseId) || !accountContext.length || !browserSessionId.length || browserSessionId.length > 256) throw new Error('浏览器控制租约标识无效');
  return { version: 1, instanceId, accountContext, epoch: Number(control.epoch), kind: 'browser', resourceId: browserSessionId, clientId, leaseId, generation: Number(control.generation) };
}
export function parseSettings(value: unknown) {
  const response = record(value, '浏览器设置');
  const chromePath = text(response.chromePath, '浏览器路径');
  if (chromePath.length > 32768 || /[\0-\x1f\x7f]/.test(chromePath)) throw new Error('浏览器路径响应无效');
  if (response.detectedPath !== null && typeof response.detectedPath !== 'string') throw new Error('自动发现路径响应无效');
  if (typeof response.available !== 'boolean' || response.available !== (response.detectedPath !== null)) throw new Error('自动发现状态响应无效');
  return { chromePath, detectedPath: response.detectedPath as string | null, available: response.available };
}
export function parseRuntimeDiagnostics(runtimeValue: unknown, diagnosticsValue: unknown, sessionId: string) {
  const diagnostics = record(diagnosticsValue, '浏览器诊断');
  const session = parseRuntime(runtimeValue, sessionId);
  parseRuntime(diagnostics.runtime, sessionId);
  const status = text(session.status, '浏览器会话状态'), owner = text(session.engineOwner, '浏览器引擎所有者');
  const mode = text(session.runtimeMode, '浏览器运行模式');
  const chrome = diagnostics.chrome === null ? '未发现' : text(record(diagnostics.chrome, 'Chrome').path, 'Chrome 路径');
  const node = diagnostics.node === null ? '未设置' : text(diagnostics.node, 'Node 路径');
  const proxy = text(diagnostics.proxy, '代理状态'), bridge = text(diagnostics.bridge, 'Bridge 状态');
  return {
    content: [`契约：v${session.contractVersion}`, `状态：${status} · ${mode}`, `Node：${node}`, `Chrome：${chrome}`, `代理：${proxy}`, `Bridge：${bridge}`].join('\n'),
    upgrade: owner !== 'plugin' || Number(session.contractVersion) < 3,
  };
}
function parseRuntime(value: unknown, sessionId: string) {
  const runtime = record(value, '浏览器运行时');
  if (runtime.pluginId !== 'com.xsec.workspace.browser' || runtime.contractVersion !== 3) throw new Error('浏览器运行时契约无效');
  const session = record(runtime.session, '浏览器运行时会话');
  if (session.browserSessionId !== sessionId) throw new Error('浏览器运行时会话归属无效');
  if (!Number.isSafeInteger(session.contractVersion) || Number(session.contractVersion) < 1) throw new Error('浏览器会话契约版本无效');
  text(session.status, '浏览器会话状态'); text(session.engineOwner, '浏览器引擎所有者'); text(session.runtimeMode, '浏览器运行模式');
  parseSettings(runtime.settings);
  return session;
}
export function parseUpgrade(value: unknown, sessionId: string) {
  const result = record(value, '浏览器会话升级');
  if (result.upgraded !== false || result.stateTransferred !== false || result.legacyBrowserSessionId !== sessionId ||
    result.action !== 'create_v3_session' || result.contractVersion !== 3) throw new Error('浏览器会话升级契约无效');
  return text(result.message, '浏览器会话升级消息');
}
