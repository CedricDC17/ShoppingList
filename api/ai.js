// api/ai.js — fonction serverless Vercel (runtime Node)
//
// Seul endroit qui connaît la clé API : elle ne doit jamais aller dans le
// front (toute variable VITE_ est publiée en clair dans le JavaScript).
//
// Variables d'environnement (réglages Vercel, ou .env en local) :
//   AI_API_KEY   clé du fournisseur (obligatoire). Une clé Claude (sk-ant-…)
//                passe par l'API Anthropic ; toute autre clé, par une API
//                compatible OpenAI (AI_BASE_URL).
//   AI_PASSWORD  mot de passe demandé dans l'appli avant tout appel à l'IA.
//                Sans lui, n'importe qui connaissant l'adresse peut s'en servir.
//   AI_MODEL     modèle, ou plusieurs séparés par des virgules : le suivant
//                prend le relais si le précédent est saturé ou en panne.
//                Par défaut : claude-opus-5-5 avec une clé Claude, sinon les
//                modèles gratuits d'OpenRouter (DEFAULT_FREE_MODELS).
//   AI_BASE_URL  API compatible OpenAI, par défaut https://openrouter.ai/api/v1
//                (Groq : https://api.groq.com/openai/v1). Ignorée avec Claude.
//
// Tâches :
//   { task: 'recipe', text }   -> { text }    recette remise au format de l'appli
//   { task: 'rayons', items }  -> { rayons }  { "nom d'article": "id-rayon" }

import { createHash, timingSafeEqual } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { RECIPE_INSTRUCTIONS, RAYON_INSTRUCTIONS } from '../src/utils/recipePrompt.js'
import { RAYONS } from '../src/utils/rayons.js'

const MAX_RECIPE_CHARS = 12000
const MAX_ITEMS = 80
const RAYON_IDS = new Set(RAYONS.map(r => r.id))
// Vercel coupe la fonction à 60 s (vercel.json) : on garde de la marge
const TIME_BUDGET_MS = 55000

// Modèles gratuits d'OpenRouter, lents (30 s et plus). Gemma répond sans
// phase de réflexion ; le routeur "openrouter/free" sert en dernier recours.
const DEFAULT_FREE_MODELS = [
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'openrouter/free',
]
const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'
// Modèles Claude qui acceptent le repli côté serveur en cas de refus
const CLAUDE_FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])

const apiKey = () => process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY || ''
const usesClaude = () => apiKey().startsWith('sk-ant-')

function modelList() {
  const models = (process.env.AI_MODEL || '').split(',').map(m => m.trim()).filter(Boolean)
  if (models.length) return models
  return usesClaude() ? [DEFAULT_CLAUDE_MODEL] : DEFAULT_FREE_MODELS
}

function upstreamError(message, status = 502) {
  const error = new Error(message)
  error.status = status
  return error
}

function timeoutError() {
  const error = new Error('timeout')
  error.name = 'TimeoutError'
  return error
}

/** Essaie chaque modèle dans l'ordre, dans la limite du temps imparti. */
async function complete(system, user) {
  const deadline = Date.now() + TIME_BUDGET_MS
  let lastError
  for (const model of modelList()) {
    const remaining = deadline - Date.now()
    if (remaining < 5000) break
    try {
      const text = usesClaude()
        ? await completeClaude(model, system, user, remaining)
        : await completeOpenAI(model, system, user, remaining)
      // Certains modèles entourent malgré tout leur réponse d'un bloc ```
      return text.trim().replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```$/, '').trim()
    } catch (err) {
      if (err.name === 'TimeoutError') throw err
      lastError = err
      console.error(`Modèle ${model} indisponible :`, err.message)
    }
  }
  throw lastError
}

async function completeClaude(model, system, user, timeoutMs) {
  const client = new Anthropic({ apiKey: apiKey() })
  const params = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: user }],
    // Mise en forme simple : peu de réflexion, réponse plus rapide
    output_config: { effort: 'low' },
  }
  // Le signal borne aussi les nouvelles tentatives automatiques du SDK
  const options = { timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs) }

  let response
  try {
    response = CLAUDE_FALLBACK_MODELS.has(model)
      ? await client.beta.messages.create(
          { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
          options
        )
      : await client.messages.create(params, options)
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError || err instanceof Anthropic.APIUserAbortError) {
      throw timeoutError()
    }
    if (err instanceof Anthropic.RateLimitError) throw upstreamError(err.message, 429)
    if (err instanceof Anthropic.APIError) throw upstreamError(`${err.status ?? ''} ${err.message}`)
    throw err
  }

  if (response.stop_reason === 'refusal') throw upstreamError('refus du modèle')
  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
  if (!text.trim()) throw upstreamError('réponse vide')
  return text
}

async function completeOpenAI(model, system, user, timeoutMs) {
  const base = (process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      'X-Title': 'Liste Courses',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: 4000,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw upstreamError(`HTTP ${response.status} ${detail.slice(0, 300)}`, response.status === 429 ? 429 : 502)
  }
  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content || !content.trim()) throw upstreamError('réponse vide')
  return content
}

async function formatRecipe(body) {
  const text = String(body.text || '').trim()
  if (!text) return [400, { error: 'empty' }]
  if (text.length > MAX_RECIPE_CHARS) return [413, { error: 'too-long' }]
  const out = await complete(RECIPE_INSTRUCTIONS, `RECETTE À REFORMATER :\n\n${text}`)
  return [200, { text: out }]
}

async function classifyRayons(body) {
  const items = (Array.isArray(body.items) ? body.items : [])
    .map(name => String(name || '').trim().slice(0, 80))
    .filter(Boolean)
  if (!items.length) return [400, { error: 'empty' }]
  if (items.length > MAX_ITEMS) return [413, { error: 'too-long' }]

  const out = await complete(RAYON_INSTRUCTIONS, items.join('\n'))
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

/** Sans AI_PASSWORD, l'IA est ouverte à tous. Comparaison à durée constante. */
function passwordOk(req) {
  const expected = process.env.AI_PASSWORD
  if (!expected) return true
  let given = ''
  try {
    given = decodeURIComponent(String(req.headers?.['x-ai-password'] || ''))
  } catch {
    return false
  }
  const hash = value => createHash('sha256').update(value).digest()
  return timingSafeEqual(hash(given), hash(expected))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' })
  if (!apiKey()) return res.status(503).json({ error: 'not-configured' })
  if (!passwordOk(req)) return res.status(401).json({ error: 'password' })

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
