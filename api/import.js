// api/import.js — fonction serverless Vercel (runtime Node)
//
// Import d'une recette depuis son lien : { url } -> { text, image }
//   text   recette au format de l'appli
//   image  photo de la recette en data URL, ou '' (l'import marche sans)
//
// Le navigateur n'a pas le droit de lire la page d'un autre site : on la
// télécharge ici, puis src/utils/recipeFromPage.js en extrait la recette.
// Aucune clé API, aucune IA : seulement les données que le site publie.
//
// Le serveur va chercher des adresses fournies par l'utilisateur ou par la
// page, d'où ces garde-fous : http(s) sur les ports standard, aucune adresse
// locale ou privée (vérifiée à chaque redirection), 3 Mo de page et 2,5 Mo de
// photo au plus, 10 s pour la page et 6 s pour la photo.
// Même mot de passe que l'IA (AI_PASSWORD).

import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { passwordOk, readBody } from './_shared.js'
import { recipeFromPage } from '../src/utils/recipeFromPage.js'

const TIMEOUT_MS = 10000
const MAX_BYTES = 3 * 1024 * 1024
const MAX_REDIRECTS = 4
const MAX_URL_LENGTH = 2000

// La photo voyage en base64 dans la réponse (+33 %), que Vercel limite à 4,5 Mo
const IMAGE_TIMEOUT_MS = 6000
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024
const MAX_IMAGE_TRIES = 3
const IMAGE_TYPES = /^image\/(?:jpeg|png|webp|gif|avif)$/i

// Certains sites refusent les robots : on se présente comme un navigateur.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const PAGE_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.6',
}
const IMAGE_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5',
}

// Adresses locales, privées ou réservées : jamais contactées.
const BLOCKED = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 3],
]) BLOCKED.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of [
  ['::', 127], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) BLOCKED.addSubnet(net, prefix, 'ipv6')

/** Erreur prévue, renvoyée telle quelle à l'appli. */
function importError(code, status) {
  const error = new Error(code)
  error.code = code
  error.status = status
  return error
}

function isPublicAddress(address) {
  const family = isIP(address)
  if (!family) return false
  // Une IPv6 « ::ffff:127.0.0.1 » est vérifiée selon les règles IPv4
  return !BLOCKED.check(address, family === 6 ? 'ipv6' : 'ipv4')
}

/** Lien autorisé, ou exception. */
async function checkUrl(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw importError('bad-url', 400)
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw importError('bad-url', 400)
  if (url.username || url.password) throw importError('bad-url', 400)
  if (url.port && url.port !== '80' && url.port !== '443') throw importError('bad-url', 400)

  const host = url.hostname.replace(/^\[|\]$/g, '')
  let addresses = [host]
  if (!isIP(host)) {
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map(a => a.address)
    } catch {
      throw importError('unreachable', 502)
    }
  }
  if (!addresses.length || !addresses.every(isPublicAddress)) throw importError('bad-url', 400)
  return url
}

/** Télécharge une adresse en suivant les redirections, chacune revérifiée. */
async function fetchChecked(raw, signal, headers) {
  let url = await checkUrl(raw)
  for (let hop = 0; ; hop++) {
    const response = await fetch(url, { headers, redirect: 'manual', signal })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel()
      if (hop >= MAX_REDIRECTS) throw importError('unreachable', 502)
      url = await checkUrl(new URL(location, url).href)
      continue
    }
    if (response.status === 404 || response.status === 410) throw importError('not-found', 502)
    if (!response.ok) throw importError('blocked', 502)
    return { response, url: url.href }
  }
}

/**
 * Corps de la réponse, limité à `limit` octets : tronqué si `truncate`, sinon
 * null quand il dépasse. Sortir de la boucle interrompt le téléchargement.
 */
async function readBytes(response, limit, truncate) {
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    chunks.push(chunk)
    size += chunk.length
    if (size > limit) {
      if (!truncate) return null
      break
    }
  }
  return Buffer.concat(chunks).subarray(0, limit)
}

/** Corps HTML, tronqué à MAX_BYTES : le bloc de la recette est presque toujours avant. */
async function readHtml(response) {
  const type = response.headers.get('content-type') || ''
  if (type && !/html|xml/i.test(type)) {
    await response.body?.cancel()
    throw importError('not-html', 422)
  }
  const bytes = await readBytes(response, MAX_BYTES, true)
  const charset = type.match(/charset=["']?([\w-]+)/i)?.[1]
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes) // jeu de caractères inconnu
  }
}

/** Photo de la recette en data URL, ou '' : on essaie les adresses dans l'ordre. */
async function downloadImage(urls) {
  const signal = AbortSignal.timeout(IMAGE_TIMEOUT_MS)
  for (const url of urls.slice(0, MAX_IMAGE_TRIES)) {
    try {
      const { response } = await fetchChecked(url, signal, IMAGE_HEADERS)
      const type = (response.headers.get('content-type') || '').split(';')[0].trim()
      if (!IMAGE_TYPES.test(type) || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
        await response.body?.cancel()
        continue
      }
      const bytes = await readBytes(response, MAX_IMAGE_BYTES, false)
      if (bytes?.length) return `data:${type.toLowerCase()};base64,${bytes.toString('base64')}`
    } catch (err) {
      if (signal.aborted) break
      console.error('Photo ignorée :', url, err.code || err.message)
    }
  }
  return ''
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' })
  if (!passwordOk(req)) return res.status(401).json({ error: 'password' })

  const body = readBody(req)
  const link = String(body?.url || '').trim()
  if (!link || link.length > MAX_URL_LENGTH) return res.status(400).json({ error: 'bad-url' })

  try {
    const signal = AbortSignal.timeout(TIMEOUT_MS)
    const { response, url } = await fetchChecked(link, signal, PAGE_HEADERS)
    const page = recipeFromPage(await readHtml(response), url)
    if (!page) return res.status(422).json({ error: 'no-recipe' })
    const image = await downloadImage(page.images)
    return res.status(200).json({ text: page.text, image })
  } catch (err) {
    if (err.code && err.status) return res.status(err.status).json({ error: err.code })
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(504).json({ error: 'timeout' })
    }
    console.error('Import impossible :', err)
    return res.status(502).json({ error: 'unreachable' })
  }
}
