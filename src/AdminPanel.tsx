import { useCallback, useEffect, useState } from 'react'
import './App.css'

type AccountRow = {
  id: string
  username: string
  api_key_prefix: string
  points_balance: number
  created_at: string
  note: string | null
  has_key_backup?: boolean
}

const TOKEN_KEY = 'howie_admin_jwt_v1'

/** 避免 GET /api/admin-accounts 被浏览器/CDN 缓存成旧空列表 */
const noCache: RequestInit = { cache: 'no-store' }

async function parseJsonSafe(r: Response): Promise<unknown> {
  const text = await r.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    const hint = text.replace(/\s+/g, ' ').slice(0, 160)
    throw new Error(`HTTP ${r.status}：${hint || '非 JSON 响应'}`)
  }
}

function formatAdminError(j: unknown): string {
  if (!j || typeof j !== 'object') return '请求失败'
  const o = j as { error?: unknown; hint?: unknown }
  const a = typeof o.error === 'string' ? o.error : ''
  const b = typeof o.hint === 'string' ? o.hint : ''
  return [a || '请求失败', b].filter(Boolean).join(' · ')
}

function loadToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveToken(t: string) {
  try {
    sessionStorage.setItem(TOKEN_KEY, t)
  } catch {
    /* ignore */
  }
}

function makeRandomUsername() {
  const p = ['青', '墨', '云', '风', '石', '海', '星', '月', '松', '竹']
  const s = ['客', '友', '户', '员', '君']
  const a = p[Math.floor(Math.random() * p.length)]
  const b = s[Math.floor(Math.random() * s.length)]
  const tail = Math.random().toString(36).slice(2, 10)
  return `${a}${b}_${tail}`
}

function maskKey(k: string) {
  if (k.length <= 14) return '•'.repeat(Math.min(20, k.length))
  return `${k.slice(0, 10)}${'•'.repeat(18)}${k.slice(-4)}`
}

function EyeButton({ open, onClick, disabled }: { open: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="admin-eye-btn"
      disabled={disabled}
      aria-label={open ? '隐藏完整 Key' : '显示完整 Key'}
      title={open ? '隐藏' : '显示'}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {open ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      )}
    </button>
  )
}

function SecretKeyLine({
  apiKey,
  busy,
  visible,
  onToggleVisible,
}: {
  apiKey: string
  busy?: boolean
  visible: boolean
  onToggleVisible: () => void
}) {
  return (
    <div className="admin-secret-line">
      <code className="admin-secret-code">{busy ? '…' : visible ? apiKey : maskKey(apiKey)}</code>
      <EyeButton open={visible} onClick={onToggleVisible} disabled={busy} />
    </div>
  )
}

export default function AdminPanel() {
  const [password, setPassword] = useState('')
  const [token, setToken] = useState(loadToken)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [defaultGrant, setDefaultGrant] = useState(10000)
  const [newUser, setNewUser] = useState(makeRandomUsername)
  const [newPoints, setNewPoints] = useState(10000)
  const [newNote, setNewNote] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [createdVisible, setCreatedVisible] = useState(false)
  const [keyCache, setKeyCache] = useState<Record<string, string>>({})
  const [keyVisible, setKeyVisible] = useState<Record<string, boolean>>({})
  const [keyLoading, setKeyLoading] = useState<Record<string, boolean>>({})
  const [topupDraft, setTopupDraft] = useState<Record<string, number>>({})

  const authHeaders = useCallback((): Record<string, string> => {
    const t = token.trim()
    return t ? { Authorization: `Bearer ${t}` } : {}
  }, [token])

  const loadAccounts = useCallback(async () => {
    setErr('')
    try {
      const r = await fetch('/api/admin-accounts', { ...noCache, headers: { ...authHeaders() } })
      const j = (await parseJsonSafe(r)) as { accounts?: AccountRow[]; defaultGrantPoints?: number; error?: string }
      if (!r.ok) {
        setErr(formatAdminError(j))
        if (r.status === 401) setToken('')
        return
      }
      setAccounts(j.accounts ?? [])
      if (j.defaultGrantPoints != null) setDefaultGrant(j.defaultGrantPoints)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败')
    }
  }, [authHeaders, token])

  useEffect(() => {
    if (token) void loadAccounts()
  }, [token, loadAccounts])

  const login = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/admin-login', {
        ...noCache,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const j = (await parseJsonSafe(r)) as { token?: string; error?: string }
      if (!r.ok) {
        setErr(formatAdminError(j))
        return
      }
      if (j.token) {
        saveToken(j.token)
        setToken(j.token)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '登录请求失败')
    } finally {
      setBusy(false)
    }
  }

  const logout = () => {
    saveToken('')
    setToken('')
    setAccounts([])
    setKeyCache({})
    setKeyVisible({})
  }

  const createAccount = async () => {
    setBusy(true)
    setErr('')
    setCreatedKey(null)
    setCreatedVisible(false)
    const u = newUser.trim() || makeRandomUsername()
    try {
      const r = await fetch('/api/admin-accounts', {
        ...noCache,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          username: u,
          initialPoints: Number(newPoints) || defaultGrant,
          note: newNote.trim() || undefined,
        }),
      })
      const j = (await parseJsonSafe(r)) as { apiKey?: string; error?: string }
      if (!r.ok) {
        setErr(formatAdminError(j))
        return
      }
      if (j.apiKey) {
        setCreatedKey(j.apiKey)
        setCreatedVisible(false)
      }
      setNewUser(makeRandomUsername())
      await loadAccounts()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '创建请求失败')
    } finally {
      setBusy(false)
    }
  }

  const fetchFullKey = async (accountId: string) => {
    setKeyLoading((m) => ({ ...m, [accountId]: true }))
    setErr('')
    try {
      const r = await fetch(`/api/admin-account-key?accountId=${encodeURIComponent(accountId)}`, {
        ...noCache,
        headers: { ...authHeaders() },
      })
      const j = (await parseJsonSafe(r)) as { apiKey?: string; error?: string }
      if (!r.ok) {
        setErr(formatAdminError(j))
        return
      }
      if (j.apiKey) {
        setKeyCache((m) => ({ ...m, [accountId]: j.apiKey! }))
        setKeyVisible((m) => ({ ...m, [accountId]: true }))
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '请求失败')
    } finally {
      setKeyLoading((m) => ({ ...m, [accountId]: false }))
    }
  }

  const toggleRowKeyVisible = async (a: AccountRow) => {
    const id = a.id
    const hasBackup = Boolean(a.has_key_backup)
    if (!hasBackup) {
      setErr('该账户无完整 Key 备份（早期仅存哈希）。可新建账户或联系技术处理。')
      return
    }
    const next = !keyVisible[id]
    if (next) {
      if (!keyCache[id]) await fetchFullKey(id)
      else setKeyVisible((m) => ({ ...m, [id]: true }))
    } else {
      setKeyVisible((m) => ({ ...m, [id]: false }))
    }
  }

  const topupRow = async (accountId: string) => {
    const pts = topupDraft[accountId] ?? 10000
    if (!Number.isFinite(pts) || pts <= 0) {
      setErr('充值积分须为正数')
      return
    }
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/admin-accounts', {
        ...noCache,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ accountId, grantPoints: pts }),
      })
      const j = (await parseJsonSafe(r)) as { error?: string }
      if (!r.ok) {
        setErr(formatAdminError(j))
        return
      }
      await loadAccounts()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '充值请求失败')
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <div className="chat-app admin-wrap">
        <header className="header-brand">
          <h1 className="header-title">
            <span className="header-title-gradient">管理后台</span>
          </h1>
          <p className="header-tagline">助理专用 · 创建 API Key 与积分</p>
        </header>
        <div className="admin-card admin-card--narrow">
          <p className="dock-personal-hint">请输入环境变量 <code>ADMIN_PASSWORD</code> 对应的密码。</p>
          <input
            type="password"
            className="diag-field-input"
            placeholder="管理密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void login()}
          />
          {err ? <p className="admin-err">{err}</p> : null}
          <button type="button" className="diag-first-submit" disabled={busy} onClick={() => void login()}>
            {busy ? '…' : '登录'}
          </button>
          <p className="dock-personal-hint" style={{ marginTop: 16 }}>
            <a href="/" className="admin-link">
              ← 返回对话
            </a>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-app admin-wrap">
      <header className="header-brand admin-header-row">
        <div>
          <h1 className="header-title">
            <span className="header-title-gradient">管理后台</span>
          </h1>
          <p className="header-tagline admin-header-sub">默认新户积分 {defaultGrant} · 计价 100 tokens ≈ 1 积分</p>
        </div>
        <button type="button" className="chip" onClick={logout}>
          退出
        </button>
      </header>

      <div className="main-area admin-main">
        <div className="admin-layout admin-layout--stacked">
          <section className="admin-panel-col admin-panel-col--form">
            <div className="admin-card admin-card--flush">
              <h3 className="admin-h3">新建用户</h3>
              <div className="admin-form-row">
                <label className="admin-field-label">用户名</label>
                <div className="admin-input-with-action">
                  <input
                    className="diag-field-input"
                    placeholder="随机或自填"
                    value={newUser}
                    onChange={(e) => setNewUser(e.target.value)}
                  />
                  <button type="button" className="chip admin-shuffle-btn" onClick={() => setNewUser(makeRandomUsername())}>
                    换一批
                  </button>
                </div>
              </div>
              <div className="admin-form-row admin-form-row--inline">
                <div className="admin-field-grow">
                  <label className="admin-field-label">初始积分</label>
                  <input
                    className="diag-field-input"
                    type="number"
                    value={newPoints}
                    onChange={(e) => setNewPoints(Number(e.target.value))}
                  />
                </div>
                <div className="admin-field-grow">
                  <label className="admin-field-label">备注（可选）</label>
                  <input
                    className="diag-field-input"
                    placeholder="备注"
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                  />
                </div>
              </div>
              {createdKey ? (
                <div className="admin-created">
                  <p className="admin-created-title">
                    <strong>新生成的 API Key</strong>
                    <span className="admin-created-hint">（可随时在下方列表用眼睛查看，需配置 ADMIN_SECRET）</span>
                  </p>
                  <SecretKeyLine
                    apiKey={createdKey}
                    visible={createdVisible}
                    onToggleVisible={() => setCreatedVisible((v) => !v)}
                  />
                </div>
              ) : null}
              {err ? <p className="admin-err">{err}</p> : null}
              <button type="button" className="diag-first-submit" disabled={busy} onClick={() => void createAccount()}>
                {busy ? '…' : '生成账户与 Key'}
              </button>
            </div>
          </section>

          <section className="admin-panel-col admin-panel-col--table">
            <div className="admin-card admin-card--flush">
              <h3 className="admin-h3">全部用户</h3>
              <p className="dock-personal-hint admin-table-hint">
                在表格中复制用户 ID、查看完整 Key、续费充值。完整 Key 依赖库内加密备份；旧账户可能仅有前缀。
              </p>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>用户 ID</th>
                      <th>用户名</th>
                      <th>API Key</th>
                      <th className="admin-th-points">积分</th>
                      <th>续费</th>
                      <th>备注</th>
                      <th>创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((a) => {
                      const full = keyCache[a.id]
                      const vis = keyVisible[a.id]
                      const loading = keyLoading[a.id]
                      const hasBackup = Boolean(a.has_key_backup)
                      const display =
                        full && vis ? full : full && !vis ? maskKey(full) : `${a.api_key_prefix}…`
                      return (
                        <tr key={a.id}>
                          <td className="admin-mono admin-id admin-col-id" title={a.id}>
                            <button
                              type="button"
                              className="admin-id-btn"
                              onClick={() => void navigator.clipboard.writeText(a.id)}
                            >
                              {a.id.slice(0, 8)}… 复制
                            </button>
                          </td>
                          <td className="admin-col-user">{a.username}</td>
                          <td className="admin-key-cell admin-col-key">
                            <div className="admin-key-wrap">
                              <code
                                className={`admin-key-text${full && vis ? ' admin-key-text--revealed' : ''}`}
                                title={full && vis ? full : undefined}
                              >
                                {loading ? '…' : display}
                              </code>
                              <EyeButton
                                open={Boolean(full && vis)}
                                disabled={loading || !hasBackup}
                                onClick={() => void toggleRowKeyVisible(a)}
                              />
                            </div>
                            {!hasBackup ? <span className="admin-key-warn">无备份</span> : null}
                          </td>
                          <td className="admin-col-points">{a.points_balance}</td>
                          <td className="admin-col-topup">
                            <div className="admin-row-topup">
                              <input
                                type="number"
                                className="admin-topup-input"
                                min={1}
                                value={topupDraft[a.id] ?? 10000}
                                onChange={(e) =>
                                  setTopupDraft((m) => ({
                                    ...m,
                                    [a.id]: Number(e.target.value),
                                  }))
                                }
                              />
                              <button
                                type="button"
                                className="chip chip--cta admin-topup-go"
                                disabled={busy}
                                onClick={() => void topupRow(a.id)}
                              >
                                充值
                              </button>
                            </div>
                          </td>
                          <td className="admin-col-note">{a.note || '—'}</td>
                          <td className="admin-mono admin-time admin-col-time">{new Date(a.created_at).toLocaleString()}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>

        <p className="dock-personal-hint admin-footer-link">
          <a href="/" className="admin-link">
            ← 返回对话
          </a>
        </p>
      </div>
    </div>
  )
}
