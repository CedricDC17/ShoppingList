// api/ai.js — fonction serverless Vercel (runtime Node)
//
// Seul endroit qui connaît la clé API : elle ne doit jamais aller dans le
// front (toute variable VITE_ est publiée en clair dans le JavaScript).
//
// Variables d'environnement (réglages Vercel, ou .env en local) :
//   AI_API_KEY   clé OpenRouter (obligatoire)
//   AI_MODEL     modèle, par défaut "openrouter/free" (routeur de modèles gratuits)
//   AI_BASE_URL  API compatible OpenAI, par défaut https://openrouter.ai/api/v1
//
// Tâches :
//   { task: 'recipe', text }   -> { text }    recette remise au format de l'appli
//   { task: 'rayons', items }  -> { rayons }  { "nom d'article": "id-rayon" }

import { RECIPE_INSTRUCTIONS, RAYON_INSTRUCTIONS } from '../src/utils/recipePrompt.js'
import { RAYONS } from '../src/utils/rayons.js'

const MAX_RECIPE_CHARS = 12000
const MAX_ITEMS = 80
const RAYON_IDS = new Set(RAYONS.map(r => r.id))

async function complete(system, user, maxTokens) {
  const key = process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY
  const base = (process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-Title': 'Liste Courses',
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || 'openrouter/free',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(55000),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error('Réponse IA en erreur', response.status, detail.slice(0, 500))
    const error = new Error('upstream')
    error.status = response.status === 429 ? 429 : 502
    throw error
  }
  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content || !content.trim()) {
    const error = new Error('empty')
    error.status = 502
    throw error
  }
  // Certains modèles entourent malgré tout leur réponse d'un bloc ```
  return content.trim().replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```$/, '').trim()
}

async function formatRecipe(body) {
  const text = String(body.text || '').trim()
  if (!text) return [400, { error: 'empty' }]
  if (text.length > MAX_RECIPE_CHARS) return [413, { error: 'too-long' }]
  const out = await complete(RECIPE_INSTRUCTIONS, `RECETTE À REFORMATER :\n\n${text}`, 4000)
  return [200, { text: out }]
}

async function classifyRayons(body) {
  const items = (Array.isArray(body.items) ? body.items : [])
    .map(name => String(name || '').trim().slice(0, 80))
    .filter(Boolean)
  if (!items.length) return [400, { error: 'empty' }]
  if (items.length > MAX_ITEMS) return [413, { error: 'too-long' }]

  const out = await complete(RAYON_INSTRUCTIONS, items.join('\n'), 4000)
  const json = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)
  let parsed
  try {
    parsed = JSON.parse(json)
  } catch {
    return [502, { error: 'bad-json' }]
  }
  const rayons = {}
  for (const name of items) {
    const id = parsed[name]
    if (RAYON_IDS.has(id)) rayons[name] = id
  }
  return [200, { rayons }]
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' })
  if (!process.env.AI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    return res.status(503).json({ error: 'not-configured' })
  }

  let body = req.body || {}
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      return res.status(400).json({ error: 'bad-request' })
    }
  }

  try {
    const [status, payload] =
      body.task === 'recipe' ? await formatRecipe(body)
      : body.task === 'rayons' ? await classifyRayons(body)
      : [400, { error: 'unknown-task' }]
    return res.status(status).json(payload)
  } catch (err) {
    if (err.name === 'TimeoutError') return res.status(504).json({ error: 'timeout' })
    console.error('Appel IA impossible :', err)
    return res.status(err.status || 500).json({ error: 'upstream' })
  }
}
