// src/components/ServingsStepper.jsx
import { Minus, Plus } from 'lucide-react'

/** Sélecteur « − 4 + personnes » : les quantités suivent. */
export default function ServingsStepper({ value, onChange, base }) {
  const changed = base && value !== base
  return (
    <div className="servings-stepper">
      <button type="button" onClick={() => onChange(Math.max(1, value - 1))} aria-label="Une personne de moins">
        <Minus size={14} />
      </button>
      <span className="servings-value">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(99, value + 1))} aria-label="Une personne de plus">
        <Plus size={14} />
      </button>
      <span className="servings-label">personne{value > 1 ? 's' : ''}</span>
      {changed && (
        <button type="button" className="servings-reset" onClick={() => onChange(base)}>
          recette : {base}
        </button>
      )}
    </div>
  )
}
