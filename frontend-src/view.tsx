import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { Badge, ControlButton, ControlIconButton, Drawer, EmptyState, ErrorState, Field, Input, PageHeader, Section, Select, Spinner, Toolbar } from '@xsec/ui-react';
import { ArrowLeft, ArrowRight, Globe, Maximize2, Minimize2, Plus, Radio, RefreshCw, Square, X } from 'lucide-react';
import tokenStyles from '@xsec/design-tokens/styles.css';
import componentStyles from '@xsec/ui-react/styles.css';
import styles from './styles.css';
import { BrowserTheme, readTheme } from './theme';
import { displayUrl, pageLabel } from './protocol.js';
import type { BrowserController, BrowserState, RuntimeState, SettingsState, Host } from './controller.js';

interface Snapshot {
  state: BrowserState; settings: SettingsState; runtime: RuntimeState;
  live: boolean; canControl: boolean; controlBusy: boolean; hasLease: boolean; settingsReady: boolean; settingsDirty: boolean; closingPages: Set<string>;
  hasPage: boolean; frameVisible: boolean; error: string; errorId: string; surfaceErrorId: string;
}
function snapshot(controller: BrowserController): Snapshot {
  const session = controller.session(), controlError = controller.controlError;
  return {
    state: { ...controller.state }, settings: { ...controller.settings }, runtime: { ...controller.runtime },
    live: Boolean(session?.live), canControl: Boolean(controller.lease?.control && controller.lease.browserSessionId === session?.id),
    controlBusy: controller.controlBusy, hasLease: Boolean(controller.lease), settingsReady: controller.settingsReady, settingsDirty: controller.settingsDirty(), closingPages: new Set(controller.closingPages),
    hasPage: Boolean(controller.page()), frameVisible: Boolean(session?.live && controller.page() && controller.surface && controller.frameSurfaceId === controller.surface.id),
    error: controlError || controller.state.error,
    errorId: controlError ? controller.errors.control : controller.errors.workspace,
    surfaceErrorId: controller.errors.surface,
  };
}
function Surface({ controller, model, address }: { controller: BrowserController; model: Snapshot; address: RefObject<HTMLInputElement> }) {
  const canvas = useRef<HTMLCanvasElement>(null), keyboard = useRef<HTMLTextAreaElement>(null);
  const s = model.state;
  useLayoutEffect(() => {
    if (!canvas.current || !keyboard.current || !address.current) throw new Error('浏览器画面节点未挂载');
    controller.bindSurface(canvas.current, keyboard.current, address.current);
  }, [controller, address]);
  return <div className="browser-stage">
    <canvas ref={canvas} aria-label="真实浏览器页面" hidden={!model.frameVisible}/>
    <textarea ref={keyboard} className="browser-keyboard" aria-label="浏览器键盘输入" disabled={!model.canControl}/>
    {!model.live || !model.hasPage ? <div className="browser-stage-message">{s.loading || (model.live && Boolean(s.pending)) ? <Spinner label={s.loading ? '正在读取浏览器会话…' : '正在读取新标签页…'}/> :
      <EmptyState title={!s.sessions.length ? '当前任务还没有浏览器会话' : model.live ? '浏览器中没有页面' : '该浏览器会话已经结束'}
        description={!s.sessions.length ? 'MCP 创建浏览器后，这里会映射真实页面。' : undefined}/>}</div> : null}
    {model.live && model.hasPage && !model.frameVisible && !s.surfaceError && s.surfaceState !== 'closed' ? <div className="browser-stage-message"><Spinner label={s.surfaceState === 'live' ? '正在读取真实浏览器画面…' : '正在连接真实浏览器…'}/></div> : null}
    {s.surfaceError || s.surfaceState === 'closed' ? <div className="browser-stage-message"><ErrorState title={s.surfaceState === 'closed' ? '页面连接已关闭' : '浏览器画面不可用'}
      description={s.surfaceError || undefined} errorId={model.surfaceErrorId || undefined}
      action={<ControlButton variant="secondary" onClick={() => void controller.retrySurface().catch(error => void controller.failSurface(error))}>重新连接</ControlButton>}/></div> : null}
  </div>;
}
function Workspace({ controller, model }: { controller: BrowserController; model: Snapshot }) {
  const s = model.state, busy = Boolean(s.busy), address = useRef<HTMLInputElement>(null), newTab = useRef<HTMLButtonElement>(null);
  const tabButtons = useRef(new Map<string, HTMLButtonElement>()), lastFocusedTab = useRef<string>();
  const options = s.sessions.map(session => ({ value: session.id, label: `${session.live ? '运行中' : '已结束'} · ${session.id.slice(0, 10)}` }));
  const selectedPage = s.pages.find(page => page.id === s.pageId);
  useLayoutEffect(() => {
    if (address.current && document.activeElement !== address.current) address.current.value = s.address;
    const removed = lastFocusedTab.current && !s.pages.some(page => page.id === lastFocusedTab.current);
    if (removed && (document.activeElement === document.body || !document.activeElement?.isConnected)) {
      const target = s.pageId ? tabButtons.current.get(s.pageId) : undefined;
      if (target && !target.disabled) target.focus({ preventScroll: true });
      else if (!newTab.current?.disabled) newTab.current?.focus({ preventScroll: true });
      lastFocusedTab.current = undefined;
    }
  }, [s.address, s.pageId, s.pages]);
  const actionDisabled = !model.live || !model.hasPage || !model.canControl || busy;
  const owners = s.groups.filter(group => group.current_page_id === s.pageId).map(group => group.owner === 'parent' ? '主 Agent' : '子 Agent').join(' · ');
  return <main className={`browser-workspace${s.focus ? ' focus' : ''}`}>
    <Toolbar className="browser-session-toolbar" role="toolbar" aria-label="浏览器会话操作">
      <div className="browser-session-select"><Select aria-label="浏览器会话" placeholder="未匹配当前浏览器会话" options={options}
        value={s.sessionId} disabled={!options.length} onValueChange={value => { if (value !== null) void controller.chooseSession(value).catch(error => controller.fail(error, 'session-select')); }}/></div>
      <Badge tone={model.live ? 'success' : 'neutral'}>{model.live ? '已连接' : '离线'}</Badge>
      <ControlIconButton label="跟随 Agent" title="跟随 Agent" aria-pressed={s.follow} data-active={s.follow}
        onClick={() => { controller.state.follow = !controller.state.follow; if (controller.state.follow) controller.state.pending = null; controller.render(); void controller.manualRefresh(); }}><Radio/></ControlIconButton>
      <ControlIconButton label={s.focus ? '退出浏览器专注模式' : '进入浏览器专注模式'} title={s.focus ? '退出浏览器专注模式' : '进入浏览器专注模式'}
        aria-pressed={s.focus} data-active={s.focus} onClick={() => void controller.setFocus(!controller.focusTarget).catch(error => controller.fail(error, 'presentation'))}>
        {s.focus ? <Minimize2/> : <Maximize2/>}</ControlIconButton>
      <ControlIconButton label="重新读取浏览器会话" title="重新读取浏览器会话" onClick={() => void controller.manualRefresh()}><RefreshCw/></ControlIconButton>
      <ControlIconButton label="浏览器运行时诊断" title="浏览器运行时诊断" disabled={!s.sessionId} onClick={() => void controller.showRuntimeDiagnostics()}><Globe/></ControlIconButton>
      <div className="browser-control"><Badge tone={model.canControl ? 'success' : 'neutral'}>{model.canControl ? '控制中' : '观察中'}</Badge>
        {model.canControl ? <ControlButton variant="secondary" disabled={!model.live || !model.hasLease || model.controlBusy} loading={model.controlBusy}
          onClick={() => void controller.changeControl(null)}>释放控制权</ControlButton> : <>
          <ControlButton variant="secondary" disabled={!model.live || !model.hasLease || model.controlBusy} loading={model.controlBusy} onClick={() => void controller.changeControl(false)}>获取控制权</ControlButton>
          <ControlButton variant="ghost" disabled={!model.live || !model.hasLease || model.controlBusy} onClick={() => void controller.changeControl(true)}>接管</ControlButton>
        </>}
      </div>
    </Toolbar>
    <div className="browser-tabbar">
      <div className="browser-tabs" role="group" aria-label="浏览器标签页">
        {s.pages.map(page => <div className="browser-tab" data-page-id={page.id} data-active={page.id === s.pageId} key={page.id}>
          <ControlButton variant="ghost" className="browser-tab-open" aria-current={page.id === s.pageId ? 'page' : undefined} disabled={model.closingPages.has(page.id)}
            ref={node => { if (node) tabButtons.current.set(page.id, node); else tabButtons.current.delete(page.id); }}
            onFocus={() => { lastFocusedTab.current = page.id; }} onClick={() => void controller.choosePage(page.id).catch(error => controller.fail(error, 'page-select'))}>
            <Globe size={15}/><span title={pageLabel(page)}>{pageLabel(page)}</span>
            {s.groups.some(group => group.current_page_id === page.id) ? <Badge>{s.groups.some(group => group.current_page_id === page.id && group.owner === 'parent') ? '主' : '子'}</Badge> : null}
          </ControlButton>
          <ControlIconButton className="browser-tab-close" label={`关闭 ${pageLabel(page)}`} title={`关闭 ${pageLabel(page)}`}
            disabled={!model.live || !model.canControl || busy || model.closingPages.has(page.id)} onFocus={() => { lastFocusedTab.current = page.id; }} onClick={() => void controller.closePage(page.id)}><X size={15}/></ControlIconButton>
        </div>)}
      </div>
      <ControlIconButton ref={newTab} label={!model.live ? '浏览器会话未运行，无法新建标签页' : busy ? '浏览器正在处理操作' : '新建浏览器标签页'}
        title="新建浏览器标签页" disabled={!model.live || !model.canControl || busy} onClick={() => void controller.createPage()}><Plus/></ControlIconButton>
    </div>
    <Toolbar className="browser-navigation" role="toolbar" aria-label="浏览器导航">
      <ControlIconButton label="浏览器后退" title="浏览器后退" disabled={actionDisabled} onClick={() => void controller.pageAction('back')}><ArrowLeft/></ControlIconButton>
      <ControlIconButton label="浏览器前进" title="浏览器前进" disabled={actionDisabled} onClick={() => void controller.pageAction('forward')}><ArrowRight/></ControlIconButton>
      <ControlIconButton label="浏览器刷新" title="浏览器刷新" disabled={actionDisabled} onClick={() => void controller.pageAction('reload')}><RefreshCw/></ControlIconButton>
      <ControlIconButton label="停止加载" title="停止加载" disabled={actionDisabled} onClick={() => void controller.pageAction('stop')}><Square/></ControlIconButton>
      <Input ref={address} className="browser-address" aria-label="浏览器地址" placeholder="输入授权范围内的 HTTP/HTTPS 地址" disabled={actionDisabled}
        onFocus={() => { controller.addressEditPageId = s.pageId; }} onChange={event => { controller.state.address = event.currentTarget.value; }}
        onBlur={event => { controller.addressEditPageId = null; controller.updateAddress(true); event.currentTarget.value = controller.state.address; }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !controller.state.busy) void controller.navigate(); }}/>
    </Toolbar>
    {model.error ? <div className="browser-operation-error"><ErrorState title="浏览器操作失败" description={model.error} errorId={model.errorId || undefined}
      action={<ControlButton variant="secondary" onClick={() => void controller.manualRefresh()}>重新读取</ControlButton>}/></div> : null}
    <Surface controller={controller} model={model} address={address}/>
    <footer className="browser-footer"><span title={selectedPage?.url}>{selectedPage ? `${displayUrl(selectedPage.url)} · ${selectedPage.id.slice(0, 12)}` : '未选择页面'}</span><span>{owners}</span><span>1280 × 800</span></footer>
    <Drawer open={model.runtime.open} onOpenChange={open => { if (!open) controller.closeRuntimeDiagnostics(); }} title="浏览器运行时诊断" description="查看当前会话的引擎与连接配置。">
      {model.runtime.loading ? <Spinner label="正在读取运行时诊断…"/> : model.runtime.error ? <ErrorState title="运行时诊断失败" description={model.runtime.error} errorId={model.runtime.errorId}
        action={<ControlButton onClick={() => void controller.showRuntimeDiagnostics()}>重新读取</ControlButton>}/> : <pre className="browser-runtime-info" tabIndex={0}>{model.runtime.content}</pre>}
      {model.runtime.upgrade ? <ControlButton loading={model.runtime.upgrading} onClick={() => void controller.upgradeRuntimeSession()}>升级旧浏览器会话</ControlButton> : null}
    </Drawer>
  </main>;
}
function Settings({ controller, model }: { controller: BrowserController; model: Snapshot }) {
  const s = model.settings, disabled = s.loading || s.saving, composing = useRef(false);
  const canSave = !disabled && model.settingsReady && model.settingsDirty;
  const status = s.loading ? '正在读取浏览器路径…' : s.saving ? '正在保存浏览器路径…' : s.saved ? '浏览器路径已保存；新建浏览器会话时生效。' :
    s.writeUncertain ? '保存结果尚未确认。草稿已保留，请重新读取后核对。' : !model.settingsReady ? '请重新读取以确认当前设置。' : model.settingsDirty ? '有未保存的修改。重新读取会保留当前草稿。' : '当前设置已读取。';
  const errorTitle = s.errorKind === 'validation' ? '请检查浏览器路径' : s.errorKind === 'read' ? '无法读取浏览器路径' : '浏览器路径保存失败';
  const platform = navigator.userAgent, placeholder = platform.includes('Windows') ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : platform.includes('Mac') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome';
  return <main className="browser-settings" data-settings-state={s.loading ? 'loading' : s.saving ? 'saving' : !model.settingsReady ? 'unconfirmed' : 'ready'}>
    <PageHeader title="浏览器会话" description="配置新建浏览器会话使用的 Chrome 可执行文件。"/>
    <Section title="浏览器路径"><p>留空使用系统自动发现结果。自定义路径须指向本机的浏览器可执行文件，保存后在新建会话时生效。</p>
      <Field label="自定义 Chrome 路径" hint="支持 Windows、macOS 和 Linux 绝对路径。按 Enter 保存。">{props => <Input {...props} aria-invalid={s.errorKind === 'validation'} placeholder={placeholder} value={s.path}
        disabled={disabled} spellCheck={false} autoComplete="off" onChange={event => controller.editSettings(event.currentTarget.value)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.repeat && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !composing.current) {
          event.preventDefault(); if (canSave) void controller.saveSettings();
        } }}/>}</Field>
      <div className="browser-settings-actions"><ControlButton loading={s.saving} disabled={!canSave} onClick={() => void controller.saveSettings()}>保存</ControlButton>
        <ControlButton variant="secondary" disabled={disabled} onClick={() => void controller.loadSettings()}>重新读取</ControlButton></div>
      <div className="browser-settings-feedback" role="status" aria-live="polite" aria-atomic="true">
        {disabled ? <Spinner label={status}/> : <p className={s.saved ? 'browser-saved' : undefined}>{status}</p>}
      </div>
      {s.error ? <ErrorState title={errorTitle} description={s.error} errorId={s.errorId}/> : null}
    </Section>
    <Section title="已确认的设置">
      {model.settingsReady ? <div className="browser-detected"><Badge>{s.chromePath ? '使用自定义路径' : '使用系统自动发现'}</Badge>
        <p>{s.chromePath || '新建会话时使用系统发现的浏览器。'}</p>
        {model.settingsDirty ? <p>上方草稿尚未应用，当前新会话仍使用此处设置。</p> : null}
      </div> : <p>{disabled ? '操作完成后显示已确认的设置。' : '当前持久设置尚未确认，请重新读取。'}</p>}
    </Section>
    <Section title="系统自动发现">
      {model.settingsReady ? <div className="browser-detected"><Badge tone={s.available ? 'success' : 'warning'}>{s.available ? '已发现系统浏览器' : '未发现系统浏览器'}</Badge>
        {s.detectedPath ? <p>{s.detectedPath}</p> : <p>可安装 Chrome，或填写本机已有浏览器的可执行文件路径。</p>}
        {s.chromePath ? <p>当前已设置自定义路径，系统发现结果供参考。</p> : null}
      </div> : <p>{disabled ? '正在确认系统发现结果。' : '请重新读取以获取系统发现结果。'}</p>}
    </Section>
  </main>;
}
export function mountBrowserView(element: HTMLElement, controller: BrowserController, host: Host) {
  const initial = readTheme(), root = createRoot(element);
  let active = true;
  const draw = () => {
    if (!active) return;
    const model = snapshot(controller);
    root.render(<><style>{tokenStyles + componentStyles + styles}</style><BrowserTheme initial={initial} host={host} controller={controller}>
      {controller.settingsPage() ? <Settings controller={controller} model={model}/> : <Workspace controller={controller} model={model}/>}</BrowserTheme></>);
  };
  flushSync(draw);
  return { update: draw, dispose() { if (!active) return; active = false; root.unmount(); } };
}
