export interface Context {
  kind?: string;
  visible?: boolean;
  settings?: { page?: string };
  workspace?: { binding?: { projectId?: string; assignmentId?: string; runId?: string; sessionId?: string } };
}
export interface Host {
  apiVersion: number;
  context: Context;
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  onTheme(callback: (theme: Record<string, string>) => void): { dispose(): void };
  onData(stream: string, callback: (raw: ArrayBuffer) => void): { dispose(): void };
}
export interface Session { id: string; run_id: string; live: boolean; status: string; created_at: number; }
export interface Page { id: string; title: string; url: string; opener_id?: string | null; }
export interface Group { current_page_id: string; owner: string; updated_at: number; }
export interface BrowserState {
  sessions: Session[]; sessionId: string | null; pages: Page[]; groups: Group[]; pageId: string | null;
  follow: boolean; focus: boolean; address: string; error: string; surfaceError: string; busy: string;
  loading: boolean; surfaceState: string; pending: unknown;
}
export interface SettingsState {
  loading: boolean; saving: boolean; path: string; error: string; errorId: string; saved: boolean;
  detectedPath: string | null; available: boolean;
}
export interface RuntimeState {
  open: boolean; loading: boolean; content: string; error: string; errorId: string; upgrade: boolean; upgrading: boolean;
}
export class BrowserController {
  constructor(rpc: ReturnType<typeof browserRpc>, context: Context, host: Host);
  state: BrowserState;
  settings: SettingsState;
  runtime: RuntimeState;
  errors: { workspace: string; surface: string; control: string };
  root?: HTMLElement;
  disposed: boolean;
  settingsReady: boolean;
  lease?: { browserSessionId: string; control?: unknown };
  surface?: { id: string };
  frameSurfaceId: string;
  closingPages: Set<string>;
  controlBusy: boolean;
  controlError: string;
  focusTarget: boolean;
  addressEditPageId: string | null;
  mount(root: HTMLElement, context?: Context): void | Promise<void>;
  update(context?: Context): Promise<void>;
  dispose(): Promise<void>;
  stopBusiness(): Promise<void>;
  render(): void;
  settingsPage(): boolean;
  bindSurface(canvas: HTMLCanvasElement, keyboard: HTMLTextAreaElement, address: HTMLInputElement): void;
  session(): Session | null;
  page(): Page | null;
  fail(error: unknown, stage: string): void;
  failSurface(error: unknown): Promise<void>;
  chooseSession(id: string): Promise<void>;
  choosePage(id: string): Promise<void>;
  createPage(): Promise<void>;
  closePage(id: string): Promise<void>;
  pageAction(action: string): Promise<void>;
  navigate(): Promise<void>;
  updateAddress(force?: boolean): void;
  manualRefresh(): Promise<void>;
  setFocus(value: boolean): Promise<void>;
  changeControl(takeover: boolean | null): Promise<void>;
  retrySurface(): Promise<void>;
  showRuntimeDiagnostics(): Promise<void>;
  closeRuntimeDiagnostics(): void;
  upgradeRuntimeSession(): Promise<void>;
  loadSettings(): Promise<void>;
  editSettings(path: string): void;
  saveSettings(): Promise<void>;
}
export function browserRpc(host: Host): {
  [key: string]: (...args: never[]) => unknown;
};
