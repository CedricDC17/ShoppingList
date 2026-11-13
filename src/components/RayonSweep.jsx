// src/components/RayonSweep.jsx
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { classifyRayonsWithAI } from '../utils/ai'
import { rayonLabel, RAYON_AUTRE } from '../utils/rayons'

/**
 * L'IA propose un rayon pour chaque article connu. Rien n'est appliqué sans
 * validation : un rayon corrigé à la main peut ainsi être conservé.
 */
export default function RayonSweep({ items, onApply, onClose }) {
  const [progress, setProgress] = useState({ done: 0, total: items.length })
  const [proposals, setProposals] = useState(null) // { [nom]: idRayon }
  const [rejected, setRejected] = useState([]) // ids d'articles décochés
  const [error, setError] = useState('')
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    let cancelled = false
    const names = [...new Set(items.map(i => i.name))]
    classifyRayonsWithAI(names, (done, total) => !cancelled && setProgress({ done, total }))
      .then(result => !cancelled && setProposals(result))
      .catch(err => !cancelled && setError(err.message))
    return () => { cancelled = true }
    // Analyse lancée une seule fois, à l'ouverture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const changes = useMemo(() => {
    if (!proposals) return []
    return items
      .map(item => ({ item, from: item.rayon || RAYON_AUTRE, to: proposals[item.name] }))
      .filter(c => c.to && c.to !== c.from)
      .sort((a, b) => a.item.name.localeCompare(b.item.name))
  }, [items, proposals])

  const toggle = id =>
    setRejected(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))

  const accepted = changes.filter(c => !rejected.includes(c.item.id))

  const apply = async () => {
    setApplying(true)
    try {
      await onApply(accepted.map(c => ({ id: c.item.id, rayon: c.to })))
      onClose()
    } catch (err) {
      console.error(err)
      setError("Les changements n'ont pas pu être enregistrés.")
      setApplying(false)
    }
  }

  return (
    <div
      className="overlay"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="overlay-content" onClick={e => e.stopPropagation()}>
        <button className="btn-close" onClick={onClose}>✖</button>
        <h2 className="overlay-title">Ranger avec l'IA</h2>

        {error && <p className="ai-tools-error" role="alert">{error}</p>}

        {!proposals && !error && (
          <p className="missing-hint">
            Analyse des articles… {progress.done}/{progress.total}
          </p>
        )}

        {proposals && changes.length === 0 && (
          <p className="missing-hint">Tout est déjà dans le bon rayon.</p>
        )}

        {changes.length > 0 && (
          <>
            <p className="missing-hint">
              {changes.length} article{changes.length > 1 ? 's' : ''} à déplacer. Décoche ceux
              que tu veux laisser où ils sont.
            </p>
            <div className="missing-ingredients-list">
              {changes.map(({ item, from, to }) => (
                <label className="missing-ingredient-row sweep-row" key={item.id}>
                  <input
                    type="checkbox"
                    checked={!rejected.includes(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <span className="sweep-name">{item.name}</span>
                  <span className="sweep-move">
                    {rayonLabel(from)} <ArrowRight size={12} /> <b>{rayonLabel(to)}</b>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}

        <div className="overlay-footer">
          <button className="btn-modify" onClick={onClose}>
            {changes.length ? 'Annuler' : 'Fermer'}
          </button>
          {changes.length > 0 && (
            <button className="btn-save" onClick={apply} disabled={applying || !accepted.length}>
              {applying ? 'Enregistrement…' : `Appliquer (${accepted.length})`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
