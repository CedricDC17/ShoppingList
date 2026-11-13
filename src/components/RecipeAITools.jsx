// src/components/RecipeAITools.jsx
import { useState } from 'react'
import { Copy, Check, Sparkles, Undo2 } from 'lucide-react'
import { buildRecipePrompt } from '../utils/recipePrompt'
import { formatRecipeWithAI } from '../utils/ai'
import { copyText } from '../utils/clipboard'

/**
 * Deux façons de nettoyer une recette mal formatée :
 * - « Copier le prompt » : consignes + recette actuelle, à coller dans n'importe
 *   quelle IA ; on recolle ensuite sa réponse ici.
 * - « Formater avec l'IA » : la même chose sans quitter l'appli.
 *
 * @param getText  () => texte actuel de la recette
 * @param onApply  (texte) => remplace la recette par ce texte
 */
export default function RecipeAITools({ getText, onApply }) {
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [previous, setPrevious] = useState(null)

  const copyPrompt = async () => {
    setError('')
    const ok = await copyText(buildRecipePrompt(getText()))
    if (!ok) {
      setError('Copie impossible sur cet appareil.')
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const format = async () => {
    const text = getText().trim()
    if (!text || loading) return
    setError('')
    setLoading(true)
    try {
      const result = await formatRecipeWithAI(text)
      setPrevious(text)
      onApply(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const undo = () => {
    onApply(previous)
    setPrevious(null)
  }

  return (
    <div className="ai-tools">
      <div className="ai-tools-row">
        <button type="button" className="btn-ghost small" onClick={copyPrompt}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Prompt copié' : 'Copier le prompt'}
        </button>
        <button type="button" className="btn-ghost small" onClick={format} disabled={loading}>
          <Sparkles size={14} />
          {loading ? 'Mise en forme…' : "Formater avec l'IA"}
        </button>
        {previous !== null && !loading && (
          <button type="button" className="btn-ghost small" onClick={undo}>
            <Undo2 size={14} /> Annuler
          </button>
        )}
      </div>
      {copied && (
        <p className="field-hint">
          Colle-le dans ChatGPT, Claude… puis recolle sa réponse ici à la place de la recette.
        </p>
      )}
      {error && <p className="ai-tools-error" role="alert">{error}</p>}
    </div>
  )
}
