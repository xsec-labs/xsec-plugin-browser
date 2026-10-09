import { useLayoutEffect, useState, type ReactNode } from 'react';
import { ControlThemeProvider, ErrorState } from '@xsec/ui-react';
import { themeAttributes, type ThemeSettings } from '@xsec/design-tokens';
import type { BrowserController, Host } from './controller.js';

function parseTheme(theme: Record<string, string>): ThemeSettings {
  const mode = theme['color-mode'], density = theme['ui-density'], motion = theme['reduce-motion'], size = theme['ui-font-size'];
  if (mode !== 'light' && mode !== 'dark') throw new Error('Host 颜色模式无效');
  if (density !== 'compact' && density !== 'comfortable') throw new Error('Host 控件密度无效');
  if (motion !== 'true' && motion !== 'false') throw new Error('Host 动效偏好无效');
  if (typeof size !== 'string' || !/^\d+(?:\.\d+)?px$/.test(size)) throw new Error('Host 字号无效');
  const settings: ThemeSettings = { colorMode: mode, density, reducedMotion: motion === 'true', fontScale: Number(size.slice(0, -2)) / 14, locale: 'zh-CN' };
  themeAttributes(settings);
  return settings;
}
export function readTheme() {
  const style = getComputedStyle(document.documentElement);
  return parseTheme(Object.fromEntries(['color-mode', 'ui-density', 'reduce-motion', 'ui-font-size'].map(key => [key, style.getPropertyValue('--xsec-' + key).trim()])));
}
export function BrowserTheme({ host, controller, initial, children }: {
  host: Host; controller: BrowserController; initial: ThemeSettings; children: ReactNode;
}) {
  const [settings, setSettings] = useState(initial);
  const [error, setError] = useState<{ message: string; id: string }>();
  useLayoutEffect(() => {
    let active = true, failed = false;
    const subscription = host.onTheme(value => {
      if (!active || failed) return;
      try { setSettings(parseTheme(value)); }
      catch (cause) {
        failed = true;
        const id = crypto.randomUUID();
        console.error('browser.theme.failed', { operation_id: id, outcome: 'failed' });
        setError({ message: cause instanceof Error ? cause.message : String(cause), id });
        void controller.stopBusiness().catch(disposalError => {
          console.error('browser.theme.disposal.failed', { operation_id: id, outcome: 'failed' });
          if (active) setError({ message: `${cause instanceof Error ? cause.message : String(cause)}；释放浏览器资源失败：${disposalError instanceof Error ? disposalError.message : String(disposalError)}`, id });
        });
      }
    });
    return () => { active = false; subscription.dispose(); };
  }, [controller, host]);
  return <ControlThemeProvider settings={settings} className="browser-theme">{error ?
    <ErrorState title="Host 显示设置无效" description={error.message} errorId={error.id}/> : children}</ControlThemeProvider>;
}
