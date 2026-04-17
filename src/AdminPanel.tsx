import { useCallback, useEffect, useState } from 'react'
import './App.css'

type AccountRow = {
  id: string
  username: string
  api_key_prefix: string
  points_balance: number
  created_at: string
  note: string | null
}

const TOKEN_KEY = 'howie_admin_jwt_v1'

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

export default function AdminPanel() {
  const [password, setPassword] = useState('')
  const [token, setToken] = useState(loadToken)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [defaultGrant, setDefaultGrant] = useState(10000)
  const [newUser, setNewUser] = useState('')
  const [newPoints, setNewPoints] = useState(10000)
  const [newNote, setNewNote] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [topupId, setTopupId] = useState('')
  const [topupPts, setTopupPts] = useState(10000)

  const authHeaders = useCallback((): Record<string, string> => {
    const t = token.trim()
    return t ? { Authorization: `Bearer ${t}` } : {}
  }, [token])

  const loadAccounts = useCallback(async () => {
    setErr('')
    const r = await fetch('/api/admin-accounts', { headers: { ...authHeaders() } })
    const j = (await r.json()) as { accounts?: AccountRow[]; defaultGrantPoints?: number; error?: string }
    if (!r.ok) {
      setErr(j.error || '加载失败')
      if (r.status === 401) setToken('')
      return
    }
    setAccounts(j.accounts ?? [])
    if (j.defaultGrantPoints != null) setDefaultGrant(j.defaultGrantPoints)
  }, [authHeaders, token])

  useEffect(() => {
    if (token) void loadAccounts()
  }, [token, loadAccounts])

  const login = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const j = (await r.json()) as { token?: string; error?: string }
      if (!r.ok) {
        setErr(j.error || '登录失败')
        return
      }
      if (j.token) {
        saveToken(j.token)
        setToken(j.token)
      }
    } finally {
      setBusy(false)
    }
  }

  const logout = () => {
    saveToken('')
    setToken('')
    setAccounts([])
  }

  const createAccount = async () => {
    setBusy(true)
    setErr('')
    setCreatedKey(null)
    try {
      const r = await fetch('/api/admin-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          username: newUser.trim(),
          initialPoints: Number(newPoints) || defaultGrant,
          note: newNote.trim() || undefined,
        }),
      })
      const j = (await r.json()) as { apiKey?: string; error?: string; warning?: string }
      if (!r.ok) {
        setErr(j.error || '创建失败')
        return
      }
      if (j.apiKey) setCreatedKey(j.apiKey)
      setNewUser('')
      await loadAccounts()
    } finally {
      setBusy(false)
    }
  }

  const topup = async () => {
    if (!topupId.trim()) return
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/admin-accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ accountId: topupId.trim(), grantPoints: Number(topupPts) || 0 }),
      })
      const j = (await r.json()) as { error?: string }
      if (!r.ok) {
        setErr(j.error || '充值失败')
        return
      }
      await loadAccounts()
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
        <div className="admin-card">
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
      <header className="header-brand">
        <h1 className="header-title">
          <span className="header-title-gradient">管理后台</span>
        </h1>
        <button type="button" className="chip" onClick={logout}>
          退出
        </button>
      </header>

      <div className="main-area" style={{ padding: '16px 20px' }}>
        <p className="dock-personal-hint">
          默认新户积分：<strong>{defaultGrant}</strong>（可用环境变量 DEFAULT_GRANT_POINTS 调整）。计价：每{' '}
          <strong>100</strong> tokens 约扣 1 积分（TOKENS_PER_POINT）。
        </p>
        <p className="dock-personal-hint">
          粗算参考：若 DeepSeek 约 ¥2/百万 tokens，则 <strong>¥10</strong> 厂商成本约对应数百万 tokens
          量级；具体以账单为准。
        </p>

        <div className="admin-card" style={{ marginTop: 16 }}>
          <h3 className="admin-h3">新建用户</h3>
          <input
            className="diag-field-input"
            placeholder="用户名（唯一）"
            value={newUser}
            onChange={(e) => setNewUser(e.target.value)}
          />
          <input
            className="diag-field-input"
            type="number"
            placeholder="初始积分"
            value={newPoints}
            onChange={(e) => setNewPoints(Number(e.target.value))}
            style={{ marginTop: 8 }}
          />
          <input
            className="diag-field-input"
            placeholder="备注（可选）"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            style={{ marginTop: 8 }}
          />
          {createdKey ? (
            <p className="admin-created">
              <strong>请立即保存 API Key（只显示一次）：</strong>
              <code>{createdKey}</code>
            </p>
          ) : null}
          {err ? <p className="admin-err">{err}</p> : null}
          <button type="button" className="diag-first-submit" disabled={busy} onClick={() => void createAccount()}>
            生成账户与 Key
          </button>
        </div>

        <div className="admin-card" style={{ marginTop: 16 }}>
          <h3 className="admin-h3">续费充值</h3>
          <input
            className="diag-field-input"
            placeholder="用户 UUID（从下方表格复制）"
            value={topupId}
            onChange={(e) => setTopupId(e.target.value)}
          />
          <input
            className="diag-field-input"
            type="number"
            placeholder="增加积分"
            value={topupPts}
            onChange={(e) => setTopupPts(Number(e.target.value))}
            style={{ marginTop: 8 }}
          />
          <button type="button" className="chip chip--cta" style={{ marginTop: 10 }} disabled={busy} onClick={() => void topup()}>
            充值
          </button>
        </div>

        <div className="admin-card" style={{ marginTop: 16 }}>
          <h3 className="admin-h3">全部用户</h3>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>用户 ID（充值用）</th>
                  <th>用户名</th>
                  <th>Key 前缀</th>
                  <th>积分</th>
                  <th>备注</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td className="admin-mono admin-id" title={a.id}>
                      <button
                        type="button"
                        className="admin-id-btn"
                        onClick={() => void navigator.clipboard.writeText(a.id)}
                      >
                        {a.id.slice(0, 8)}… 复制
                      </button>
                    </td>
                    <td>{a.username}</td>
                    <td>
                      <code>{a.api_key_prefix}</code>
                    </td>
                    <td>{a.points_balance}</td>
                    <td>{a.note || '—'}</td>
                    <td className="admin-mono">{new Date(a.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="dock-personal-hint">充值时请粘贴完整用户 ID（可点击行内复制，或从数据库查看）。</p>
        </div>

        <p className="dock-personal-hint" style={{ marginTop: 16 }}>
          <a href="/" className="admin-link">
            ← 返回对话
          </a>
        </p>
      </div>
    </div>
  )
}
