module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.status(200).json({
    ok: true,
    hasDeepseekKey: Boolean(process.env.DEEPSEEK_API_KEY),
    hasTavilyKey: Boolean(process.env.TAVILY_API_KEY),
  })
}
