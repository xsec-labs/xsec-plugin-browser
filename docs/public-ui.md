# 浏览器工作区公共 UI

工作区与 Chrome 设置使用 `@xsec/ui-react` 0.1.7、`@xsec/design-tokens` 0.1.2 和 React 18.3.1。会话选择、控制权、标签、地址、诊断弹窗与设置字段遵循相同主题、字号、密度和减少动效设置。窄屏工具栏按可用空间换行，真实浏览器画面保持自身宽高比。

Controller 继续拥有会话、页面、控制租约、画面流与输入状态，React 视图呈现其快照。关闭当前标签先关闭画面流，关闭中的页面不会重新创建流。点击画布保留键盘输入焦点；控制获取按 Host 的 `{control: ControlRef}` 响应契约读取。设置保存后回读持久化值，非法输入保留草稿并展示操作错误。

Host 的页面归属修复独立维护在 Desktop 仓库：当前页切换在同一 SQLite transaction 中保留已观察页面并去重追加新页。损坏的集合明确返回 `PAGE_GROUP_PAGES_INVALID`，事务保持原状态。两项真实 SQLite 回归在旧实现均失败，修复后均通过。任务代次和浏览器会话边界继续校验。

## 验证

`rtk npm run validate` 通过类型、13 项协议与解析契约、包契约、单文件生成物一致性及八项 Skill 检查。生成 frontend、许可证与 CycloneDX SBOM 同源，制品包含自己的依赖并按锁文件核验版本。

真实 paired Server、OMP、SQLite、loopback 代理、Chrome 和生产 iframe 沙箱通过 17 项检查：首次画面、控制获取与导航、鼠标键盘与 Unicode 输入、按钮和滚轮、诊断弹窗 Escape 及焦点返回、专注模式、新建标签、两个标签反复切换、关闭并返回原页、五种视口主题/字号、控制释放、精确画面 ACK、隐藏恢复和销毁。34 个 ACK 与实际收到的画面序列对应；页面错误和失败 RPC 为零。复核 1280px 浅色及 320px 深色 18px 字号截图。

Chrome 设置已在隔离 macOS arm64 Desktop Host 验证真实指针、焦点、校验、保存回读、重载及 frontend/Host 日志。该原生记录对应设置实现相同的前一份 frontend SHA；随后新增的工作区标签生命周期代码通过上述 Server/Chromium 验收。原生快照已停止、释放并回收 371,011,584 bytes。

## 性能

相同 Host、二进制、运行时、manifest、1280×900 视口和生产沙箱采用 ABBA 顺序，每侧四项预热、16 项正式样本，共 40 次 mount/dispose。就绪结束于首次真实画面 presentation，显式刷新结束于实际页面列表 RPC 回执；堆读数在同一父 renderer 中强制 GC 后取得。

| 指标 | 原版 | 公共 UI | 变化 |
| --- | --- | --- | --- |
| 首次真实画面就绪 | 65.75 ms | 97.65 ms | +31.90 ms |
| 显式刷新 | 39.05 ms | 32.60 ms | −6.45 ms |
| 常驻 JS heap | 3,829,980 B | 4,054,418 B | +224,438 B（+5.86%） |
| 销毁后 JS heap | 3,661,496 B | 3,662,200 B | +704 B（+0.0192%） |
| 单文件 gzip（level 9） | 18,326 B | 116,836 B | +98,510 B |

首帧和制品大小超过方案的 10% 调查线，技术状态保留 `INVESTIGATE`。单文件入口承担 React DOM、Base UI、Floating UI 和公共组件的固定代码成本，沿用生产沙箱契约、ControlThemeProvider 与实际使用组件的裁剪。工程决定接受上述绝对成本，保留完整原始数据。成功的只读 mount/refresh 对比没有触发原版控制获取缺陷；有限 GC 观测不证明长时间会话的内存行为。

## 证据与边界

证据目录：`/Users/xiaosong/.codex/visualizations/2026/10/02/01a0faad-6517-7cd3-90b5-b818bc64660d/plugin-browser-ui`。关键收据为 `workspace-real-tab-selection-v3-report.json`、`workspace-tab-selection-visual-review.json`、`performance-summary.json`、`performance-cost-decision.json`、`observed-pages-after-report.json` 和 `settings-native-pointer-focus-readback.json`。阶段资源报告记录实际命令、耗时、峰值 RSS、swap、磁盘变化和缓存位置。

工作区原生键盘、系统中文输入法、读屏、Windows、Linux 和 macOS Intel 尚未在本批验证。平台追加验收根据 Host/native 变化选择目标，正式发布另有门禁。插件公共 UI 的回滚撤销对应提交并重建 frontend/许可证/SBOM；Host 页面归属修复可独立保留。持久化 schema、浏览器协议和声明权限保持原有格式，已确认设置恢复通过显式设置写入完成。
