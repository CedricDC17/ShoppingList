// src/components/RecipeLinkImport.jsx
import { useState } from 'react'
import { Download } from 'lucide-react'
import { importRecipeFromUrl } from '../utils/api'

/**
 * Bouton « Importer depuis marmiton.org », affiché à la place des outils IA
 * quand le texte de création contient un lien. La recette importée remplace le
 * lien dans la zone de texte, puis passe par l'aperçu comme un collage.
 *
 * @param url       lien trouvé dans la zone de texte
 * @param onImport  (texte) => remplace le contenu de la zone de texte
 */
export default function RecipeLinkImport({ url, onImport }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  let site = url
  try {
    site = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    // lien illisible : affiché tel quel, le serveur dira ce qui ne va pas
  }

  const run = async () => {
    if (loading) return
    setError('')
    setLoading(true)
    try {
      onImport(await importRecipeFromUrl(url))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="ai-tools">
      <button type="button" className="btn-primary link-import-btn" onClick={run} disabled={loading}>
        <Download size={16} />
        {loading ? 'Import en cours…' : `Importer depuis ${site}`}
      </button>
      <p className="field-hint">
        Marche avec la plupart des sites de recettes (Marmiton, 750g, Ricardo…), pas avec
        Instagram ni TikTok : pour eux, colle plutôt le texte de la recette.
      </p>
      {error && <p className="ai-tools-error" role="alert">{error}</p>}
    </div>
  )
}
