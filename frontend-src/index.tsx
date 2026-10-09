import { BrowserController, browserRpc, type Host, type Context } from './controller.js';

export function createController(host: Host) {
  if (host.apiVersion !== 2) throw new Error('不支持的浏览器 Frontend API');
  console.debug('browser.frontend.activated', { apiVersion: host.apiVersion });
  const controller = new BrowserController(browserRpc(host), host.context, host);
  return {
    mount(root: HTMLElement, context: Context = host.context) { return controller.mount(root, context); },
    update(context: Context = host.context) { return controller.update(context); },
    dispose() { return controller.dispose(); },
  };
}
