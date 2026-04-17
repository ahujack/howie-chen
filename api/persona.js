/**
 * 云端人设 CRUD：Authorization: Bearer <Clerk JWT> 或 X-API-Key: sk_…（计费账户即 Key 账号）
 * user_sub：Clerk sub 或 billing:<account_id>
 */
const { getPool, ensurePersonaTable } = require('../lib/db.cjs')
const { resolvePersonaUserSub } = require('../lib/personaIdentity.cjs')

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key')
}

function parseBody(req) {
  const b = req.body
  if (b && typeof b === 'object') return b
  return null
}

module.exports = async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  const identity = await resolvePersonaUserSub(req)
  if (!identity) {
    res.status(401).json({
      error:
        '需要身份：请使用右上角「登录」（Clerk），或在请求头携带有效的 X-API-Key: sk_…（与计费 Key 相同，用于云端人设）',
    })
    return
  }
  const sub = identity.userSub

  const pool = getPool()
  if (!pool) {
    res.status(503).json({ error: '未配置 DATABASE_URL，无法使用云端人设' })
    return
  }

  try {
    await ensurePersonaTable()
  } catch (e) {
    console.error('[persona] ensureTables', e)
    res.status(500).json({ error: '数据库初始化失败' })
    return
  }

  const id = req.query?.id

  try {
    if (req.method === 'GET') {
      if (id) {
        const r = await pool.query(
          `SELECT id, name, five_dims, voice_notes, taboos, cases_summary, updated_at
           FROM creator_personas WHERE id = $1 AND user_sub = $2`,
          [id, sub],
        )
        if (r.rowCount === 0) {
          res.status(404).json({ error: '未找到人设' })
          return
        }
        res.status(200).json(r.rows[0])
        return
      }
      const r = await pool.query(
        `SELECT id, name, five_dims, updated_at FROM creator_personas WHERE user_sub = $1 ORDER BY updated_at DESC`,
        [sub],
      )
      res.status(200).json({ personas: r.rows })
      return
    }

    if (req.method === 'POST') {
      const body = parseBody(req) || {}
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : '我的人设'
      const five_dims =
        body.five_dims && typeof body.five_dims === 'object' ? body.five_dims : {}
      const voice_notes = typeof body.voice_notes === 'string' ? body.voice_notes.slice(0, 4000) : null
      const taboos = typeof body.taboos === 'string' ? body.taboos.slice(0, 2000) : null
      const cases_summary = typeof body.cases_summary === 'string' ? body.cases_summary.slice(0, 4000) : null
      const r = await pool.query(
        `INSERT INTO creator_personas (user_sub, name, five_dims, voice_notes, taboos, cases_summary)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6)
         RETURNING id, name, five_dims, voice_notes, taboos, cases_summary, updated_at`,
        [sub, name, JSON.stringify(five_dims), voice_notes, taboos, cases_summary],
      )
      res.status(201).json(r.rows[0])
      return
    }

    if (req.method === 'PATCH') {
      if (!id) {
        res.status(400).json({ error: '缺少 id' })
        return
      }
      const body = parseBody(req) || {}
      const fields = []
      const vals = []
      let n = 1
      if (typeof body.name === 'string') {
        fields.push(`name = $${n++}`)
        vals.push(body.name.trim().slice(0, 120))
      }
      if (body.five_dims && typeof body.five_dims === 'object') {
        fields.push(`five_dims = $${n++}::jsonb`)
        vals.push(JSON.stringify(body.five_dims))
      }
      if (typeof body.voice_notes === 'string') {
        fields.push(`voice_notes = $${n++}`)
        vals.push(body.voice_notes.slice(0, 4000))
      }
      if (typeof body.taboos === 'string') {
        fields.push(`taboos = $${n++}`)
        vals.push(body.taboos.slice(0, 2000))
      }
      if (typeof body.cases_summary === 'string') {
        fields.push(`cases_summary = $${n++}`)
        vals.push(body.cases_summary.slice(0, 4000))
      }
      if (fields.length === 0) {
        res.status(400).json({ error: '无可更新字段' })
        return
      }
      fields.push(`updated_at = now()`)
      vals.push(id, sub)
      const q = `UPDATE creator_personas SET ${fields.join(', ')} WHERE id = $${n++} AND user_sub = $${n++} RETURNING id, name, five_dims, voice_notes, taboos, cases_summary, updated_at`
      const r = await pool.query(q, vals)
      if (r.rowCount === 0) {
        res.status(404).json({ error: '未找到人设' })
        return
      }
      res.status(200).json(r.rows[0])
      return
    }

    if (req.method === 'DELETE') {
      if (!id) {
        res.status(400).json({ error: '缺少 id' })
        return
      }
      const r = await pool.query(`DELETE FROM creator_personas WHERE id = $1 AND user_sub = $2`, [id, sub])
      if (r.rowCount === 0) {
        res.status(404).json({ error: '未找到人设' })
        return
      }
      res.status(204).end()
      return
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('[persona]', e)
    res.status(500).json({ error: e instanceof Error ? e.message : '服务器错误' })
  }
}
