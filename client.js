/**
 * OpenCode Go quota — browser half.
 *
 * Renders one compact strip below the composer; expanding turns the strip into
 * the header of an attached card that carries the three Go plan windows. All secrets stay on the Host: this half only
 * calls the package-private `opencode-go-usage` Connection channel.
 */

window.__ModuleLoader__.load({
  id: '@local/opencode-go-usage',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // `react-dom` is a baseline module of the client table (the renderer requires
    // it); the fallback keeps the card inline if a carrier ever omits it.
    let ReactDOM = null
    try {
      ReactDOM = require('react-dom')
    } catch {
      ReactDOM = null
    }
    const useIsomorphicEffect = React.useLayoutEffect ?? React.useEffect

    const NS = 'opencode-go-usage'
    const CHANNEL = '/opencode-go-usage'
    const WINDOW_ORDER = ['rolling', 'weekly', 'monthly']
    const POLL_MS = 60_000
    const CLOCK_MS = 30_000

    const EN = {
      'strip.label': 'OpenCode Go',
      'strip.loading': 'Loading quota…',
      'strip.noKey': 'No API key · click to set',
      'strip.missing': 'Not reported',
      'window.rolling': '5-hour',
      'window.weekly': 'Week',
      'window.monthly': 'Month',
      'window.short.rolling': '5h',
      'window.short.weekly': 'wk',
      'window.short.monthly': 'mo',
      'panel.title': 'OpenCode Go quota',
      'panel.used': 'Used {percent}%',
      'panel.remaining': '{percent}% left',
      'panel.resets': 'resets in {time}',
      'panel.resetsNow': 'resetting now',
      'panel.updated': 'Updated {time}',
      'panel.stale': 'the last refresh failed',
      'panel.refresh': 'Refresh',
      'panel.key': 'API key',
      'panel.keyFromStored': 'stored in this profile',
      'panel.keyFromMemory': 'this session only',
      'panel.keyFromEnv': 'from {name}',
      'panel.keyFromFile': 'from {name}',
      'panel.keyMissing': 'Not configured',
      'panel.setKey': 'Set key',
      'panel.keys': 'Saved keys',
      'panel.keyShort': 'Key',
      'panel.addKey': 'Add another key',
      'panel.thisSession': 'This session',
      'panel.keyLabel': 'Label (optional)',
      'panel.removeKey': 'Remove key',
      'panel.removeConfirm': 'Delete?',
      'panel.changeKey': 'Change key',
      'panel.changeShort': 'Change',
      'panel.clearKey': 'Clear',
      'panel.save': 'Save',
      'panel.cancel': 'Cancel',
      'panel.keyPlaceholder': 'Paste your OpenCode Go API key',
      'panel.memoryOnly': 'This session only (not written to disk)',
      'panel.keyDetail': 'Kept in this machine\'s credential store and sent only to opencode.ai.',
      'panel.noStore': 'This profile cannot store a key; export OPENCODE_GO_API_KEY instead.',
      'panel.override': 'Using {source}. Save a key here to override it.',
      'panel.saving': 'Saving…',
      'status.rate-limited': 'rate-limited',
      'status.other': 'status {status}',
      'error.no-key': 'No OpenCode Go API key is configured yet.',
      'error.unauthorized': 'The OpenCode Go API key was rejected. Check it and try again.',
      'error.rate-limited': 'OpenCode Go rate-limited the usage query. Try again later.',
      'error.network': 'Could not reach opencode.ai. Check your network.',
      'error.timeout': 'The usage query timed out.',
      'error.http': 'The usage query failed.',
      'error.unexpected-payload': 'The usage response was not recognized.',
      'error.no-connection': 'The DSH connection is not ready.',
      'error.no-credential-store': 'This profile has no credential store; set OPENCODE_GO_API_KEY instead.',
      'error.save-failed': 'The key could not be saved.',
      'error.invalid-key': 'Enter a non-empty API key.',
      'error.generic': 'The quota query failed.',
      'error.detail': 'Details: {message}',
      'duration.days': '{days}d {hours}h',
      'duration.hours': '{hours}h{minutes}m',
      'duration.minutes': '{minutes}m',
      'duration.none': 'less than a minute',
    }

    const ZH = {
      'strip.label': 'OpenCode Go',
      'strip.loading': '正在读取额度…',
      'strip.noKey': '未配置 Key · 点击设置',
      'strip.missing': '未返回数据',
      'window.rolling': '5 小时窗口',
      'window.weekly': '本周',
      'window.monthly': '本月',
      'window.short.rolling': '5时',
      'window.short.weekly': '周',
      'window.short.monthly': '月',
      'panel.title': 'OpenCode Go 额度',
      'panel.used': '已用 {percent}%',
      'panel.remaining': '剩余 {percent}%',
      'panel.resets': '{time}后重置',
      'panel.resetsNow': '即将重置',
      'panel.updated': '更新于 {time}',
      'panel.stale': '上次刷新失败',
      'panel.refresh': '刷新',
      'panel.key': 'API Key',
      'panel.keyFromStored': '已保存在当前配置中',
      'panel.keyFromMemory': '仅本次会话',
      'panel.keyFromEnv': '来自 {name}',
      'panel.keyFromFile': '来自 {name}',
      'panel.keyMissing': '未配置',
      'panel.setKey': '设置 Key',
      'panel.keys': '已保存的 Key',
      'panel.keyShort': 'Key',
      'panel.addKey': '添加新 Key',
      'panel.thisSession': '本次会话',
      'panel.keyLabel': '标签（可选）',
      'panel.removeKey': '删除 Key',
      'panel.removeConfirm': '确认？',
      'panel.changeKey': '更换 Key',
      'panel.changeShort': '更换',
      'panel.clearKey': '清除',
      'panel.save': '保存',
      'panel.cancel': '取消',
      'panel.keyPlaceholder': '粘贴 OpenCode Go API Key',
      'panel.memoryOnly': '仅本次会话使用（不写入磁盘）',
      'panel.keyDetail': '保存在本机凭证库，只会发送给 opencode.ai。',
      'panel.noStore': '当前配置环境无法保存 Key，请改用 OPENCODE_GO_API_KEY 环境变量。',
      'panel.override': '当前使用 {source}，在这里保存 Key 可覆盖它。',
      'panel.saving': '保存中…',
      'status.rate-limited': '已限流',
      'status.other': '状态 {status}',
      'error.no-key': '还没有配置 OpenCode Go API Key。',
      'error.unauthorized': 'Key 被 OpenCode Go 拒绝了，请检查后重试。',
      'error.rate-limited': 'OpenCode Go 正在限流，请稍后再试。',
      'error.network': '连不上 opencode.ai，请检查网络。',
      'error.timeout': '额度查询超时了。',
      'error.http': '额度查询失败。',
      'error.unexpected-payload': '无法识别额度接口的返回内容。',
      'error.no-connection': 'DSH 连接尚未就绪。',
      'error.no-credential-store': '当前配置环境没有凭证存储，请改用 OPENCODE_GO_API_KEY 环境变量。',
      'error.save-failed': 'Key 保存失败。',
      'error.invalid-key': '请输入非空的 API Key。',
      'error.generic': '额度查询失败。',
      'error.detail': '详情：{message}',
      'duration.days': '{days}天{hours}时',
      'duration.hours': '{hours}时{minutes}分',
      'duration.minutes': '{minutes}分',
      'duration.none': '不到 1 分钟',
    }

    const CSS = `
.ocg-root,
.ocg-root *,
.ocg-root *::before,
.ocg-root *::after { box-sizing: border-box; }
.ocg-root {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 6px;
  max-width: 100%;
  font: var(--dsw-font-xxs-12, 12px/18px var(--dsw-font-family, inherit));
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}
.ocg-summary {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: nowrap;
  min-height: 26px;
  max-width: 100%;
  padding: 3px 10px;
  border: 0;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.ocg-summary:hover { background: var(--dsw-alias-bg-layer-2); }
.ocg-summary:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.ocg-mark {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  flex: 0 0 auto;
}
.ocg-mark[data-tone="warn"] { background: var(--dsw-alias-state-warn-primary); }
.ocg-mark[data-tone="error"] { background: var(--dsw-alias-state-error-primary); }
.ocg-mark[data-tone="idle"] { background: var(--dsw-alias-state-idle-primary); }
.ocg-title {
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-strong-12, 500 12px/18px var(--dsw-font-family, inherit));
  white-space: nowrap;
}
.ocg-window {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.ocg-ring {
  display: block;
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}
.ocg-ring[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary); }
.ocg-ring[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
.ocg-pct {
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.ocg-spacer { flex: 1 1 auto; }
.ocg-chevron { color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.ocg-root[data-expanded="true"] .ocg-summary { background: var(--dsw-alias-bg-layer-2); }
.ocg-root[data-expanded="true"] .ocg-chevron { transform: rotate(90deg); }
.ocg-pop {
  position: fixed;
  z-index: 80;
  display: flex;
  flex-direction: column;
  padding: 15px 16px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2));
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12, 12px/18px var(--dsw-font-family, inherit));
  max-height: min(60vh, 420px);
  overflow: auto;
  box-sizing: border-box;
}
.ocg-pop-inline {
  position: static;
  width: 100%;
  max-width: 100%;
  margin-top: 6px;
}
.ocg-pop-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.ocg-pop-icon {
  display: inline-flex;
  flex: 0 0 auto;
  color: var(--dsw-alias-label-secondary);
}
.ocg-pop-title {
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xs-strong-13, 500 13px/20px var(--dsw-font-family, inherit));
}
.ocg-foot {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ocg-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 168px;
  overflow: auto;
  padding: 4px;
  margin: 0 -4px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1));
  border: 1px solid var(--dsw-alias-border-l1);
}
.ocg-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 6px;
  border: 0;
  border-radius: var(--dsw-radius-xs, 4px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ocg-menu-item:hover { background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2)); }
.ocg-menu-item[aria-selected="true"] { color: var(--dsw-alias-label-primary); }
.ocg-menu-item:disabled { opacity: 0.6; cursor: default; }
.ocg-menu-row {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: var(--dsw-radius-xs, 4px);
  color: var(--dsw-alias-label-secondary);
}
.ocg-menu-row:hover { background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2)); }
.ocg-menu-row[aria-selected="true"] { color: var(--dsw-alias-label-primary); }
.ocg-menu-pick {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 5px 6px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ocg-menu-del {
  flex: 0 0 auto;
  padding: 2px 6px;
  border: 0;
  border-radius: var(--dsw-radius-xs, 4px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  font: inherit;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease;
}
.ocg-menu-row:hover .ocg-menu-del,
.ocg-menu-del:focus-visible,
.ocg-menu-del[data-armed="true"] { opacity: 1; }
.ocg-menu-del:hover { color: var(--dsw-alias-label-primary); }
.ocg-menu-del[data-armed="true"] { color: var(--dsw-alias-state-error-primary); }
.ocg-menu-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}
.ocg-menu-dot[data-on="true"] {
  background: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-label-primary);
}
.ocg-menu-label {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ocg-menu-add { color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.ocg-key-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}
.ocg-btn-icon { padding: 2px 5px; }
.ocg-caret {
  display: inline-block;
  width: 0;
  height: 0;
  border-left: 3.5px solid transparent;
  border-right: 3.5px solid transparent;
  border-top: 4px solid currentColor;
  transition: transform 120ms ease;
}
.ocg-caret[data-open="true"] { transform: rotate(180deg); }
.ocg-input-label { max-width: 34%; }
.ocg-tip {
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2));
  border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 0 6px 18px var(--dsw-alias-bg-mask-2);
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  font: var(--dsw-font-xxs-12, 12px/18px var(--dsw-font-family, inherit));
  pointer-events: none;
  white-space: nowrap;
}
.ocg-tip-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.ocg-tip-name { color: var(--dsw-alias-label-primary); }
.ocg-pop-stamp {
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  white-space: nowrap;
}
.ocg-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-xs, 4px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  line-height: 1;
  cursor: pointer;
}
.ocg-icon-btn:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.ocg-icon-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.ocg-icon-btn:disabled { opacity: .6; cursor: default; }
.ocg-pop-divider {
  height: 1px;
  margin: 8px 0 4px;
  background: var(--dsw-alias-border-l2, var(--dsw-alias-border-l1));
}
.ocg-pop-row {
  display: flex;
  flex-direction: column;
  padding: 3px 0;
}
.ocg-pop-line {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ocg-pop-label { color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); white-space: nowrap; }
.ocg-pop-value {
  color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ocg-pop-percent { color: inherit; }
.ocg-pop-percent[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary); }
.ocg-pop-percent[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
.ocg-pop-reset { color: inherit; }
.ocg-pop-missing { color: var(--dsw-alias-label-secondary); }
.ocg-pop-foot {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  padding-top: 2px;
}
.ocg-pop-key {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
}
.ocg-pop-key > .ocg-hint,
.ocg-pop-key > .ocg-mask { flex: 0 0 auto; }
.ocg-error {
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-sm, 8px);
  padding: 6px 8px;
  color: var(--dsw-alias-state-error-primary);
  overflow-wrap: anywhere;
}
.ocg-footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 2px;
  padding-top: 9px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.ocg-hint { color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.ocg-mask {
  color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums;
}
.ocg-btn {
  flex: 0 0 auto;
  padding: 3px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm, 8px);
  font: var(--dsw-font-xxs-12, 12px/18px var(--dsw-font-family, inherit));
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  cursor: pointer;
}
.ocg-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.ocg-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.ocg-btn:disabled { opacity: .6; cursor: default; }
.ocg-btn[data-primary="true"] {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
}
.ocg-input {
  flex: 1 1 180px;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
}
.ocg-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.ocg-check input { margin: 0; }
.ocg-input:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 0;
}
@media (max-width: 560px) {
  .ocg-window   .ocg-pop-reset { display: none; }
}
`

    /** Resolve the translate function for this namespace. */
    function makeT(ctx) {
      const locale = ctx.get('locale')
      if (locale === undefined || typeof locale.bind !== 'function') {
        return (key, params) => interpolate(EN[key] ?? key, params)
      }
      const bound = locale.bind(NS)
      return (key, params) => {
        const text = bound(key, params)
        return text === key ? interpolate(EN[key] ?? key, params) : text
      }
    }

    function interpolate(template, params) {
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
    }

    /**
     * Ask the Host over the package's private route. The route is document-relative,
     * like the framework's own `/api` channel, so the Web page and the Desktop
     * shell (which forwards `dsh-app://app/<path>` to its owned Host) both reach it.
     */
    async function callHost(endpoint, payload) {
      const target = `${CHANNEL.replace(/^\//, '')}/${endpoint}`
      let response
      try {
        response = await fetch(target, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload ?? {}),
        })
      } catch (error) {
        throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), { code: 'transport' })
      }
      if (response.ok !== true) {
        throw Object.assign(new Error(`HTTP ${response.status}`), { code: 'transport', status: response.status })
      }
      let result
      try {
        result = await response.json()
      } catch {
        throw Object.assign(new Error('The quota response was not JSON.'), { code: 'transport' })
      }
      if (result === null || typeof result !== 'object') {
        throw Object.assign(new Error('Malformed response.'), { code: 'generic' })
      }
      if (result.ok === true) return result.value
      const code = result.error?.code ?? 'generic'
      throw Object.assign(new Error(result.error?.message ?? 'Request failed.'), { code })
    }

    function percentile(value) {
      if (!Number.isFinite(value)) return '0'
      const rounded = Math.round(value * 10) / 10
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
    }

    function toneOf(percent) {
      if (percent >= 90) return 'error'
      if (percent >= 70) return 'warn'
      return 'ok'
    }

    function formatClock(iso) {
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return '—'
      try {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      } catch {
        return date.toISOString().slice(11, 16)
      }
    }

    /** Localized error copy plus whether the code had its own sentence. */
    function errorText(t, code) {
      const key = `error.${code}`
      const text = t(key)
      return text === key ? { text: t('error.generic'), known: false } : { text, known: true }
    }

    /** Short label for where the key comes from; empty while unconfigured. */
    function keySourceLabel(t, info) {
      if (info === null || info === undefined || info.configured !== true) return ''
      const source = info.source
      if (source === 'stored') return t('panel.keyFromStored')
      if (source === 'memory') return t('panel.keyFromMemory')
      if (typeof source !== 'string' || source === '') return t('panel.keyFromStored')
      if (source.endsWith('auth.json')) return t('panel.keyFromFile', { name: 'auth.json' })
      if (source.startsWith('OPENCODE_AUTH_CONTENT')) return t('panel.keyFromFile', { name: 'OPENCODE_AUTH_CONTENT' })
      return t('panel.keyFromEnv', { name: source })
    }

    function statusLabel(t, status) {
      if (typeof status !== 'string' || status === '' || status === 'ok') return undefined
      return status === 'rate-limited' ? t('status.rate-limited') : t('status.other', { status })
    }

    function formatDuration(t, ms) {
      if (!Number.isFinite(ms) || ms <= 0) return t('duration.none')
      const totalMinutes = Math.ceil(ms / 60_000)
      const days = Math.floor(totalMinutes / 1440)
      const hours = Math.floor((totalMinutes % 1440) / 60)
      const minutes = totalMinutes % 60
      if (days > 0) return t('duration.days', { days, hours })
      if (hours > 0) return t('duration.hours', { hours, minutes })
      return t('duration.minutes', { minutes })
    }

    /** Reset countdown for one window; undefined when the stamp is unusable. */
    function resetLabel(t, resetsAt, now) {
      if (typeof resetsAt !== 'string' || resetsAt === '') return undefined
      const at = Date.parse(resetsAt)
      if (!Number.isFinite(at)) return undefined
      const remaining = at - now
      return remaining <= 0 ? t('panel.resetsNow') : t('panel.resets', { time: formatDuration(t, remaining) })
    }

    /**
     * One quota ring: the faint track is what remains, the arc is what is used.
     * A non-zero value keeps a minimum arc so 1% still reads as "something used".
     */
    function quotaRing(percent, size) {
      const stroke = size >= 16 ? 2.4 : 1.8
      const radius = (size - stroke) / 2
      const circumference = 2 * Math.PI * radius
      const clamped = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0
      const shown = clamped > 0 ? Math.max(clamped, 5) : 0
      const centre = size / 2
      return h('svg', {
        className: 'ocg-ring',
        viewBox: `0 0 ${size} ${size}`,
        width: size,
        height: size,
        'data-tone': toneOf(clamped),
        'aria-hidden': 'true',
      },
      h('circle', {
        cx: centre,
        cy: centre,
        r: radius,
        fill: 'none',
        stroke: 'var(--dsw-alias-border-l2, var(--dsw-alias-border-l1))',
        strokeWidth: stroke,
      }),
      h('circle', {
        cx: centre,
        cy: centre,
        r: radius,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: stroke,
        strokeLinecap: 'round',
        strokeDasharray: `${circumference}`,
        strokeDashoffset: `${circumference * (1 - shown / 100)}`,
        transform: `rotate(-90 ${centre} ${centre})`,
      }))
    }

    /** A tick source so reset countdowns stay fresh without polling the Host. */
    function useClock(intervalMs) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        // A paused clock (interval 0) keeps the collapsed strip from re-rendering
        // every half minute for countdowns nobody can see.
        if (!(intervalMs > 0)) return undefined
        setNow(Date.now())
        const id = setInterval(() => { setNow(Date.now()) }, intervalMs)
        return () => { clearInterval(id) }
      }, [intervalMs])
      return now
    }

    function createQuotaStrip(ctx) {
      const t = makeT(ctx)
      const locale = ctx.get('locale')
      const subscribeLocale = (listener) => {
        if (locale === undefined || typeof locale.subscribe !== 'function') return () => {}
        return locale.subscribe(listener)
      }
      const getLocaleRevision = () => {
        if (locale === undefined || typeof locale.getSnapshot !== 'function') return 0
        return locale.getSnapshot().revision
      }

      function QuotaStrip() {
        // Re-render on locale switches without owning a state copy of the locale.
        React.useSyncExternalStore(subscribeLocale, getLocaleRevision, getLocaleRevision)
        const [snapshot, setSnapshot] = React.useState({ status: 'loading' })
        const [expanded, setExpanded] = React.useState(false)
        const [busy, setBusy] = React.useState(false)
        const [keyInfo, setKeyInfo] = React.useState(null)
        const [editingKey, setEditingKey] = React.useState(false)
        const [draft, setDraft] = React.useState('')
        const [saveError, setSaveError] = React.useState(null)
        const [saving, setSaving] = React.useState(false)
        const [memoryOnly, setMemoryOnly] = React.useState(false)
        const [placement, setPlacement] = React.useState(null)
        const [labelDraft, setLabelDraft] = React.useState('')
        const [menuOpen, setMenuOpen] = React.useState(false)
        const [tip, setTip] = React.useState(null)
        const [deletingId, setDeletingId] = React.useState(null)
        // Declared after `expanded` so the paused-clock read is initialised.
        const now = useClock(expanded ? CLOCK_MS : 0)
        const lastGoodRef = React.useRef(undefined)
        const keySourceRef = React.useRef(undefined)
        const refreshRef = React.useRef(() => {})
        const rootRef = React.useRef(null)
        const summaryRef = React.useRef(null)
        const popRef = React.useRef(null)

        React.useEffect(() => {
          let alive = true
          let loading = false
          let pendingForce = false

          const load = async (force) => {
            if (loading) {
              // A click during the background poll must not be dropped.
              if (force) pendingForce = true
              return
            }
            loading = true
            if (force) setBusy(true)
            try {
              const value = await callHost(force ? 'refresh' : 'usage', {})
              if (!alive) return
              lastGoodRef.current = value
              setSnapshot({ status: 'ready', value })
              // The usage payload already names the key source, so the dedicated
              // key query only runs when that source actually changed.
              if (value?.keySource !== undefined && value.keySource !== keySourceRef.current) {
                keySourceRef.current = value.keySource
                void loadKey()
              }
            } catch (error) {
              if (!alive) return
              const code = error?.code ?? 'generic'
              setSnapshot({ status: 'error', code, message: error?.message ?? '' })
              if (code === 'no-key' || code === 'unauthorized') void loadKey()
            } finally {
              loading = false
              if (alive && force) setBusy(false)
              if (alive && pendingForce) {
                pendingForce = false
                void load(true)
              }
            }
          }

          const loadKey = async () => {
            try {
              const value = await callHost('key', {})
              if (!alive) return
              keySourceRef.current = value?.source ?? undefined
              setKeyInfo(value)
            } catch {
              if (alive) setKeyInfo(null)
            }
          }

          refreshRef.current = () => {
            void load(true)
            void loadKey()
          }

          void load(false)
          void loadKey()

          const timer = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return
            void load(false)
          }, POLL_MS)
          const onVisibility = () => {
            if (typeof document !== 'undefined' && !document.hidden) void load(false)
          }
          if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)

          return () => {
            alive = false
            clearInterval(timer)
            if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
          }
        }, [])

        // Anchor the popover to the strip: it opens upwards, clamped to the viewport,
        // and follows layout changes while it is open.
        useIsomorphicEffect(() => {
          if (!expanded) {
            setPlacement(null)
            return undefined
          }
          const place = () => {
            const anchor = summaryRef.current
            if (anchor === null || typeof window === 'undefined') {
              setPlacement(null)
              return
            }
            const rect = anchor.getBoundingClientRect()
            const width = Math.min(300, Math.max(260, window.innerWidth - 24))
            const left = Math.min(Math.max(rect.left, 12), Math.max(12, window.innerWidth - width - 12))
            const bottom = Math.max(12, window.innerHeight - rect.top + 8)
            // Scrolling fires this per frame: keep the previous object when nothing moved.
            setPlacement((prev) => (prev !== null && prev.left === left && prev.bottom === bottom && prev.width === width
              ? prev
              : { left, bottom, width }))
          }
          // One placement per frame, however many scroll/resize events arrive.
          let frame = 0
          const schedule = () => {
            if (typeof requestAnimationFrame !== 'function') {
              place()
              return
            }
            if (frame !== 0) return
            frame = requestAnimationFrame(() => {
              frame = 0
              place()
            })
          }
          place()
          window.addEventListener('resize', schedule)
          window.addEventListener('scroll', schedule, true)
          return () => {
            if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
            window.removeEventListener('resize', schedule)
            window.removeEventListener('scroll', schedule, true)
          }
        }, [expanded])

        React.useEffect(() => {
          if (!expanded) return undefined
          const onPointerDown = (event) => {
            const root = rootRef.current
            const pop = popRef.current
            if (root !== null && event.target instanceof Node && root.contains(event.target)) return
            if (pop !== null && event.target instanceof Node && pop.contains(event.target)) return
            setExpanded(false)
            setEditingKey(false)
            setSaveError(null)
          }
          document.addEventListener('pointerdown', onPointerDown, true)
          return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
        }, [expanded])

        const good = snapshot.status === 'ready' ? snapshot.value : lastGoodRef.current
        const windows = Array.isArray(good?.windows) ? good.windows : []
        const byId = new Map(windows.map((item) => [item.id, item]))
        const problem = snapshot.status === 'error' ? snapshot.code : null
        const stale = problem !== null && good !== undefined
        const noKey = problem === 'no-key'
        const worst = windows.reduce((acc, item) => Math.max(acc, item.percent), 0)
        const tone = problem !== null ? (noKey ? 'idle' : 'error') : toneOf(worst)
        const canStore = keyInfo === null || keyInfo.writable !== false
        // No credential store in this profile: keep the form, force memory-only.
        const forceMemory = keyInfo !== null && keyInfo.writable === false
        const sourceLabel = keySourceLabel(t, keyInfo)
        const keyItems = Array.isArray(keyInfo?.items) ? keyInfo.items : []
        const activeItem = keyItems.find((item) => item.id === keyInfo?.activeId)
        const itemLabel = (item) => (item.id === 'session' ? t('panel.thisSession') : item.label)
        const activeLabel = activeItem === undefined ? '' : itemLabel(activeItem)

        const saveKey = async (event) => {
          event.preventDefault()
          const value = draft.trim()
          if (value === '') {
            setSaveError('invalid-key')
            return
          }
          setSaving(true)
          setSaveError(null)
          try {
            const payload = { key: value, persist: !memoryOnly && !forceMemory }
            if (labelDraft.trim() !== '') payload.label = labelDraft.trim()
            if (activeItem !== undefined) payload.id = activeItem.id
            const info = await callHost('setKey', payload)
            setKeyInfo(info)
            setDraft('')
            setLabelDraft('')
            setEditingKey(false)
            refreshRef.current()
          } catch (error) {
            setSaveError(error?.code ?? 'save-failed')
          } finally {
            setSaving(false)
          }
        }

        const clearKey = async () => {
          setSaving(true)
          setSaveError(null)
          try {
            const info = await callHost('clearKey', keyInfo?.activeId ? { id: keyInfo.activeId } : {})
            setKeyInfo(info)
            setEditingKey(false)
            setMenuOpen(false)
            refreshRef.current()
          } catch (error) {
            setSaveError(error?.code ?? 'save-failed')
          } finally {
            setSaving(false)
          }
        }

        const chooseKey = async (id) => {
          setSaving(true)
          setSaveError(null)
          try {
            const info = await callHost('selectKey', { id })
            setKeyInfo(info)
            setMenuOpen(false)
            refreshRef.current()
          } catch (error) {
            setSaveError(error?.code ?? 'save-failed')
          } finally {
            setSaving(false)
          }
        }

        const deleteKey = async (id) => {
          if (deletingId !== id) {
            // First press arms the button; the second one removes the key.
            setDeletingId(id)
            return
          }
          setDeletingId(null)
          setSaving(true)
          setSaveError(null)
          try {
            const info = await callHost('clearKey', { id })
            setKeyInfo(info)
            refreshRef.current()
          } catch (error) {
            setSaveError(error?.code ?? 'save-failed')
          } finally {
            setSaving(false)
          }
        }

        const keyForm = (editingKey || noKey)
          ? h('form', { className: 'ocg-pop-foot', onSubmit: (event) => { void saveKey(event) } },
            h('input', {
              className: 'ocg-input',
              type: 'password',
              autoComplete: 'new-password',
              spellCheck: false,
              'aria-label': t('panel.key'),
              autoFocus: editingKey,
              placeholder: t('panel.keyPlaceholder'),
              value: draft,
              onChange: (event) => { setDraft(event.target.value) },
            }),
            h('input', {
              className: 'ocg-input ocg-input-label',
              type: 'text',
              spellCheck: false,
              'aria-label': t('panel.keyLabel'),
              placeholder: t('panel.keyLabel'),
              value: labelDraft,
              onChange: (event) => { setLabelDraft(event.target.value) },
            }),
            h('button', { type: 'submit', className: 'ocg-btn', 'data-primary': 'true', disabled: saving },
              saving ? t('panel.saving') : t('panel.save')),
            h('button', {
              type: 'button',
              className: 'ocg-btn',
              onClick: () => { setEditingKey(false); setDraft(''); setSaveError(null) },
            }, t('panel.cancel')),
            forceMemory
              ? null
              : h('label', { className: 'ocg-check' },
                h('input', {
                  type: 'checkbox',
                  checked: memoryOnly,
                  onChange: (event) => { setMemoryOnly(event.target.checked) },
                }),
                h('span', null, t('panel.memoryOnly'))),
          )
          : null

        const storeHint = forceMemory ? h('div', { className: 'ocg-hint' }, t('panel.noStore')) : null

        const overrideHint = problem === 'unauthorized' && sourceLabel !== '' && keyInfo?.source !== 'stored'
          ? h('div', { className: 'ocg-hint' }, t('panel.override', { source: sourceLabel }))
          : null

        const errorBox = problem === null
          ? null
          : h('div', { className: 'ocg-error', role: 'alert' },
            h('div', null, errorText(t, problem).text),
            stale ? h('div', { className: 'ocg-hint' }, t('panel.stale')) : null,
            errorText(t, problem).known ? null : h('div', { className: 'ocg-hint' }, t('error.detail', { message: snapshot.message })),
            overrideHint)

        const saveErrorBox = saveError === null
          ? null
          : h('div', { className: 'ocg-error', role: 'alert' }, errorText(t, saveError).text)

        const summaryWindows = WINDOW_ORDER
          .map((id) => byId.get(id))
          .filter((item) => item !== undefined)
          .map((item) => h('span', {
            className: 'ocg-window',
            key: item.id,
            onPointerEnter: (event) => {
              if (expanded) return
              const rect = event.currentTarget.getBoundingClientRect()
              const width = 210
              setTip({
                id: item.id,
                left: Math.min(Math.max(rect.left, 12), Math.max(12, window.innerWidth - width - 12)),
                bottom: Math.max(12, window.innerHeight - rect.top + 6),
                width,
              })
            },
            onPointerLeave: () => { setTip(null) },
          },
          quotaRing(item.percent, 12),
          h('span', { className: 'ocg-hint' }, t(`window.short.${item.id}`)),
          h('span', { className: 'ocg-pct' }, `${percentile(item.percent)}%`),
          ))

        const summaryContent = problem === null
          ? summaryWindows
          : summaryWindows.length > 0
            ? summaryWindows
            : [h('span', { className: 'ocg-hint', key: 'problem', role: 'status' },
              noKey ? t('strip.noKey') : errorText(t, problem).text)]

        if (snapshot.status === 'loading') {
          summaryContent.length = 0
          summaryContent.push(h('span', { className: 'ocg-hint', key: 'loading' }, t('strip.loading')))
        }

        const summary = h('button', {
          type: 'button',
          ref: summaryRef,
          className: 'ocg-summary',
          'aria-expanded': expanded,
          'aria-haspopup': 'dialog',
          title: noKey ? t('panel.setKey') : t('panel.title'),
          onClick: () => { setExpanded((open) => !open) },
        },
        h('span', { className: 'ocg-mark', 'data-tone': tone }),
        h('span', { className: 'ocg-title' }, t('strip.label')),
        h('span', { className: 'ocg-spacer' }),
        ...summaryContent,
        h('span', { className: 'ocg-chevron', 'aria-hidden': 'true' }, '▸'),
        )

        const cardHeader = h('div', { className: 'ocg-pop-head' },
          h('svg', {
            className: 'ocg-pop-icon',
            viewBox: '0 0 16 16',
            width: 14,
            height: 14,
            'aria-hidden': 'true',
          },
          h('rect', { x: 1.5, y: 9, width: 3.2, height: 4.5, rx: 1, fill: 'currentColor', opacity: 0.45 }),
          h('rect', { x: 6.4, y: 6, width: 3.2, height: 7.5, rx: 1, fill: 'currentColor', opacity: 0.7 }),
          h('rect', { x: 11.3, y: 3, width: 3.2, height: 10.5, rx: 1, fill: 'currentColor' })),
          h('span', { className: 'ocg-pop-title' }, t('panel.title')),
          h('span', { className: 'ocg-spacer' }),
          typeof good?.fetchedAt === 'string'
            ? h('span', { className: 'ocg-pop-stamp' }, t('panel.updated', { time: formatClock(good.fetchedAt) }))
            : null,
          h('button', {
            type: 'button',
            className: 'ocg-icon-btn',
            title: t('panel.refresh'),
            'aria-label': t('panel.refresh'),
            disabled: busy,
            onClick: () => { refreshRef.current() },
          }, busy ? '…' : '↻'),
        )

        const cardRows = WINDOW_ORDER.map((id) => {
          const item = byId.get(id)
          const label = t(`window.${id}`)
          if (item === undefined) {
            return h('div', { className: 'ocg-pop-row', key: id },
              h('div', { className: 'ocg-pop-line' },
                quotaRing(0, 16),
                h('span', { className: 'ocg-pop-label' }, label),
                h('span', { className: 'ocg-spacer' }),
                h('span', { className: 'ocg-pop-missing' }, t('strip.missing'))))
          }
          const reset = resetLabel(t, item.resetsAt, now)
          const status = statusLabel(t, item.status)
          return h('div', {
            className: 'ocg-pop-row',
            key: id,
            title: `${label} · ${t('panel.used', { percent: percentile(item.percent) })} · ${t('panel.remaining', { percent: percentile(100 - item.percent) })}`,
          },
          h('div', { className: 'ocg-pop-line' },
            quotaRing(item.percent, 16),
            h('span', { className: 'ocg-pop-label' }, label),
            h('span', { className: 'ocg-spacer' }),
            h('span', { className: 'ocg-pop-value' },
              h('span', { className: 'ocg-pop-percent', 'data-tone': toneOf(item.percent) }, `${percentile(item.percent)}%`),
              reset === undefined ? null : h('span', { className: 'ocg-pop-reset' }, ` · ${reset}`),
              status === undefined ? null : h('span', { className: 'ocg-pop-reset' }, ` · ${status}`))))
        })

        const keyMenu = menuOpen && keyItems.length > 0
          ? h('div', { className: 'ocg-menu', role: 'listbox', 'aria-label': t('panel.keys') },
            ...keyItems.map((item) => h('div', {
              key: item.id,
              className: 'ocg-menu-row',
              role: 'option',
              'aria-selected': item.id === keyInfo?.activeId,
            },
            h('button', {
              type: 'button',
              className: 'ocg-menu-pick',
              disabled: saving,
              onClick: () => { void chooseKey(item.id) },
            },
            h('span', { className: 'ocg-menu-dot', 'data-on': item.id === keyInfo?.activeId ? 'true' : 'false' }),
            h('span', { className: 'ocg-menu-label' }, itemLabel(item)),
            h('span', { className: 'ocg-mask' }, item.masked)),
            h('button', {
              type: 'button',
              className: 'ocg-menu-del',
              'data-armed': deletingId === item.id ? 'true' : 'false',
              disabled: saving,
              title: t('panel.removeKey'),
              'aria-label': `${t('panel.removeKey')} ${itemLabel(item)}`,
              onClick: () => { void deleteKey(item.id) },
            }, deletingId === item.id ? t('panel.removeConfirm') : '×'))),
            h('button', {
              type: 'button',
              className: 'ocg-menu-item ocg-menu-add',
              disabled: saving,
              onClick: () => { setMenuOpen(false); setEditingKey(true); setSaveError(null) },
            }, h('span', { className: 'ocg-menu-label' }, t('panel.addKey'))))
          : null

        const cardFoot = h('div', { className: 'ocg-foot' },
          h('div', { className: 'ocg-pop-foot' },
            h('span', {
              className: 'ocg-pop-key',
              title: keyInfo?.source === undefined || keyInfo?.source === null
                ? t('panel.keyDetail')
                : `${t('panel.keyDetail')} ${keyInfo.source}`,
            },
            h('span', { className: 'ocg-hint' }, `${t('panel.keyShort')}: `),
            activeLabel === '' ? null : h('span', { className: 'ocg-key-name', title: activeLabel }, `${activeLabel} `),
            h('span', { className: 'ocg-mask' }, keyInfo?.masked ?? t('panel.keyMissing')),
            sourceLabel === '' || keyInfo?.source === 'stored'
              ? null
              : h('span', { className: 'ocg-hint' }, ` · ${sourceLabel}`)),
            h('span', { className: 'ocg-spacer' }),
            keyItems.length > 0
              ? h('button', {
                type: 'button',
                className: 'ocg-btn ocg-btn-icon',
                'aria-expanded': menuOpen,
                'aria-label': t('panel.keys'),
                disabled: saving,
                onClick: () => { setMenuOpen((open) => !open); setDeletingId(null) },
              }, h('span', { className: 'ocg-caret', 'data-open': menuOpen ? 'true' : 'false' }))
              : null,
            keyInfo?.activeId !== null && keyInfo?.activeId !== undefined
              ? h('button', {
                type: 'button',
                className: 'ocg-btn',
                disabled: saving,
                onClick: () => { void clearKey() },
              }, t('panel.clearKey'))
              : null,
            noKey
              ? null
              : h('button', {
                type: 'button',
                className: 'ocg-btn',
                onClick: () => { setEditingKey((open) => !open); setSaveError(null) },
              }, keyInfo?.configured === true ? t('panel.changeShort') : t('panel.setKey'))),
          keyMenu)

        const cardProps = {
          ref: popRef,
          role: 'dialog',
          'aria-label': t('panel.title'),
          className: ReactDOM === null ? 'ocg-pop ocg-pop-inline' : 'ocg-pop',
          ...(placement === null ? {} : { style: placement }),
        }

        const cardBody = h('div', cardProps,
          cardHeader,
          h('div', { className: 'ocg-pop-divider' }),
          cardRows,
          errorBox,
          saveErrorBox,
          keyForm,
          storeHint,
          h('div', { className: 'ocg-pop-divider' }),
          cardFoot,
        )

        const panel = expanded && (ReactDOM === null || placement !== null)
          ? ReactDOM === null ? cardBody : ReactDOM.createPortal(cardBody, document.body)
          : null

        const tipWindow = tip === null ? undefined : windows.find((item) => item.id === tip.id)
        const tipTimer = resetLabel(t, tipWindow?.resetsAt, now)
        const tipPanel = tip === null || tipWindow === undefined || expanded || ReactDOM === null
          ? null
          : ReactDOM.createPortal(
            h('div', {
              className: 'ocg-tip',
              role: 'tooltip',
              style: { position: 'fixed', left: tip.left, bottom: tip.bottom, width: tip.width },
            },
            h('div', { className: 'ocg-tip-row' },
              h('span', { className: 'ocg-tip-name' }, t(`window.${tipWindow.id}`)),
              h('span', null, `${percentile(tipWindow.percent)}%`)),
            h('div', null, t('panel.used', { percent: percentile(tipWindow.percent) })),
            h('div', null, t('panel.remaining', { percent: percentile(100 - tipWindow.percent) })),
            tipTimer === undefined ? null : h('div', null, tipTimer)),
            document.body)

        React.useEffect(() => {
          if (tip === null) return undefined
          // The strip travels with the transcript: a left-behind tooltip would lie.
          const clear = () => { setTip(null) }
          window.addEventListener('scroll', clear, true)
          window.addEventListener('resize', clear)
          return () => {
            window.removeEventListener('scroll', clear, true)
            window.removeEventListener('resize', clear)
          }
        }, [tip === null])

        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          if (editingKey) {
            setEditingKey(false)
            setDraft('')
            setSaveError(null)
            return
          }
          if (expanded) setExpanded(false)
        }

        return h('div', { className: 'ocg-root', 'data-expanded': expanded, onKeyDown, ref: rootRef },
          h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
          summary,
          tipPanel,
          panel,
        )
      }

      return QuotaStrip
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const locale = ctx.get('locale')
          if (locale === undefined || typeof locale.register !== 'function') return () => {}
          const disposers = []
          try {
            disposers.push(locale.register(NS, 'en', EN))
            disposers.push(locale.register(NS, 'zh', ZH))
          } catch (error) {
            console.error('opencode-go-usage: locale registration failed', error)
          }
          return () => {
            for (const dispose of disposers) {
              try {
                dispose()
              } catch {
                // The namespace owner already removed the dictionary.
              }
            }
          }
        }, 'opencode-go-usage: locale dictionaries')

        const translate = makeT(ctx)
        const Strip = createQuotaStrip(ctx)
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'opencode-go-usage',
          order: 20,
          label: translate('strip.label'),
        }, Strip))
      },
    }
  },
})
