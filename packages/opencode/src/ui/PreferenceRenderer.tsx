/**
 * Lightweight form renderer spec for preference schemas.
 *
 * This file provides a small React-based skeleton that Desktop can copy/adapt
 * to render registered preference schemas. It's intentionally minimal — the
 * Desktop app will likely have its own design system and should integrate
 * accordingly. This module demonstrates the shape of a renderer.
 */

import React from "react"

type FieldDef = {
  type: string
  description?: string
  options?: Array<{ label: string; value: any }>
}

export function PreferenceField({ name, def, value, onChange }: { name: string; def: FieldDef; value: any; onChange: (v: any) => void }) {
  switch (def.type) {
    case "string":
      return (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontWeight: 600 }}>{name}</label>
          <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
          {def.description && <div style={{ color: "#666" }}>{def.description}</div>}
        </div>
      )
    case "boolean":
      return (
        <div style={{ marginBottom: 12 }}>
          <label>
            <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {name}
          </label>
          {def.description && <div style={{ color: "#666" }}>{def.description}</div>}
        </div>
      )
    case "select":
      return (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontWeight: 600 }}>{name}</label>
          <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
            <option value="">(select)</option>
            {def.options?.map((o) => (
              <option key={String(o.value)} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {def.description && <div style={{ color: "#666" }}>{def.description}</div>}
        </div>
      )
    default:
      return (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontWeight: 600 }}>{name} ({def.type})</label>
          <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
        </div>
      )
  }
}

export function PreferenceTab({ schema, values, onChange }: { schema: Record<string, FieldDef>; values: Record<string, any>; onChange: (k: string, v: any) => void }) {
  return (
    <div>
      {Object.entries(schema).map(([key, def]) => (
        <PreferenceField key={key} name={key} def={def} value={values[key]} onChange={(v) => onChange(key, v)} />
      ))}
    </div>
  )
}

export default PreferenceTab
