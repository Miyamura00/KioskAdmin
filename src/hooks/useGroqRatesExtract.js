// src/hooks/useGroqRatesExtract.js
// FREE Groq vision API — https://console.groq.com (no credit card)
// .env: VITE_GROQ_API_KEY=gsk_...

import { useState } from 'react'

const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_KEY   = import.meta.env.VITE_GROQ_API_KEY || ''

// ── Adaptive slot normalization ──────────────────────────────────────────────
// No hardcoded aliases — works with ANY slot name (weekly, monthly, etc.)

function normSlot(s) {
  return String(s || '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, '')                     // remove all spaces
    .replace(/HOURS?$/,  'HRS')              // HOURS/HOUR → HRS
    .replace(/^(\d+)H$/, '$1HRS')            // 24H → 24HRS
    .replace(/^(\d+)HR$/, '$1HRS')           // 24HR → 24HRS
    .replace(/_\d+$/, '')                    // strip duplicate suffix _2 _3
}

function extractNumber(s) {
  const m = String(s || '').match(/(\d+)/)
  return m ? parseInt(m[1]) : null
}

// Returns the best matching system slot key for an AI-extracted slot name.
// Works dynamically against whatever slots the branch has configured.
function matchSlotKey(extracted, systemSlots) {
  const ne = normSlot(extracted)

  // 1. Exact normalized match (strips _2 _3 suffixes from system keys)
  const exact = systemSlots.find(s => normSlot(s) === ne)
  if (exact) return exact

  // 2. Partial contains match — e.g. "10HRS ONP" contains "ONP"
  const contains = systemSlots.find(s => {
    const ns = normSlot(s)
    return ns.includes(ne) || ne.includes(ns)
  })
  if (contains) return contains

  // 3. Number + keyword match — e.g. extracted "24 HOURS" matches system "24HRS"
  //    and extracted "WEEKLY" matches system "WEEKLY"
  const numE = extractNumber(ne)
  const numMatch = systemSlots.find(s => {
    const ns = normSlot(s)
    const numS = extractNumber(ns)
    return numE !== null && numS !== null && numE === numS &&
      (ne.replace(/\d+/, '') === ns.replace(/\d+/, '') || // same unit suffix
       ne.startsWith(String(numE)) || ns.startsWith(String(numS)))
  })
  if (numMatch) return numMatch

  // 4. Word-based fuzzy — split multi-word slot names and check keyword overlap
  //    e.g. "10HRS ONP" ↔ "10HRS OVERNIGHT"
  const wordsE = ne.split(/\b/)
  const wordMatch = systemSlots.find(s => {
    const wordsS = normSlot(s).split(/\b/)
    const shared = wordsE.filter(w => w.length > 2 && wordsS.includes(w))
    return shared.length > 0
  })
  return wordMatch || null
}

// ── Room type matching (unchanged) ──────────────────────────────────────────
function normRoom(n) {
  return String(n || '').toLowerCase().replace(/[\s_\-.]/g, '')
}
function matchRoomType(extracted, systemRooms) {
  const ne = normRoom(extracted)
  const exact = systemRooms.findIndex(r => normRoom(r) === ne)
  if (exact !== -1) return exact
  return systemRooms.findIndex(r => ne.includes(normRoom(r)) || normRoom(r).includes(ne))
}

// ── Build prompt — tells AI exactly what slots exist in this branch ──────────
function buildPrompt(category, systemSlots, systemRooms) {
  const allSlots = [...new Set(Object.values(systemSlots).flat())]
    .map(s => s.replace(/_\d+$/, ''))  // strip _2 _3 suffixes for display

  return `Extract ${category.toUpperCase()} hotel/motel rates from this image.

This branch has these time slots configured: ${allSlots.join(', ')}
This branch has these room types: ${systemRooms.join(', ')}

IMPORTANT: Use EXACTLY the slot names listed above when they match what you see in the image.
If the image has a slot not in the list (e.g. WEEKLY, MONTHLY), still include it using the exact name from the image.

Return ONLY valid JSON — no markdown, no backticks, no explanation:
{
  "roomTypes": ["Econo", "Premium", "De Luxe"],
  "slots": {
    "24HRS": [1160, 1840, 1890],
    "12HRS": [1000, 1190, 1070],
    "WEEKLY": [5000, 6000, 7000]
  }
}

Rules:
- roomTypes defines the column ORDER — each slot array must match this order exactly
- Use null for empty, dash, or missing cells
- Numbers only — no peso signs or commas
- Include ALL rows you can see in the image, including weekly, monthly, or any custom slots`
}

// ── Main hook ────────────────────────────────────────────────────────────────
export function useGroqRatesExtract() {
  const [groqStatus, setGroqStatus] = useState(null)

  async function extractAndMap(file, category, systemRooms, systemSlots) {
    if (!GROQ_KEY) {
      setGroqStatus({ type: 'error', message: 'VITE_GROQ_API_KEY not set in .env' })
      return null
    }
    setGroqStatus({ type: 'loading', message: `Scanning ${category} rates image with AI…` })

    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload  = () => res(r.result.split(',')[1])
        r.onerror = rej
        r.readAsDataURL(file)
      })

      const resp = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({
          model: GROQ_MODEL, temperature: 0, max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${file.type || 'image/jpeg'};base64,${base64}` } },
              { type: 'text', text: buildPrompt(category, systemSlots, systemRooms) }
            ]
          }]
        })
      })

      if (!resp.ok) {
        const e = await resp.json()
        throw new Error(e.error?.message || `Groq error ${resp.status}`)
      }

      const data   = await resp.json()
      const text   = data.choices?.[0]?.message?.content || ''
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())

      const extractedRooms = parsed.roomTypes || []
      const extractedSlots = parsed.slots     || {}
      const catSlots       = systemSlots[category] || []

      // Map extracted room indices → system room indices
      const roomIdxMap = {}
      extractedRooms.forEach((er, ei) => {
        const si = matchRoomType(er, systemRooms)
        if (si !== -1) roomIdxMap[ei] = si
      })

      // Map extracted slot names → system slot keys, build rate arrays
      const catRates     = {}
      let   matchedSlots = 0
      const matchedRooms = new Set()
      const unmappedSlots = []

      for (const [extractedSlot, values] of Object.entries(extractedSlots)) {
        const slotKey = matchSlotKey(extractedSlot, catSlots)
        if (!slotKey) {
          unmappedSlots.push(extractedSlot)
          continue
        }
        const arr = Array(systemRooms.length).fill(null)
        values.forEach((val, ei) => {
          const si = roomIdxMap[ei]
          if (si !== undefined && val !== null && val !== undefined) {
            arr[si] = Number(val) || 0
            matchedRooms.add(si)
          }
        })
        if (arr.some(v => v !== null)) { catRates[slotKey] = arr; matchedSlots++ }
      }

      const unmappedRooms = extractedRooms.filter((_, ei) => roomIdxMap[ei] === undefined)

      const result = {
        rates:   { [category]: catRates },
        summary: { category, matchedSlots, matchedRooms: matchedRooms.size,
                   totalRooms: systemRooms.length, unmappedRooms, unmappedSlots }
      }

      let msg = `Extracted ${matchedSlots} slot(s) × ${matchedRooms.size} room type(s).`
      if (unmappedRooms.length)  msg += ` ⚠️ Unmatched rooms: ${unmappedRooms.join(', ')}`
      if (unmappedSlots.length)  msg += ` ⚠️ Unmatched slots: ${unmappedSlots.join(', ')}`

      setGroqStatus({ type: 'success', message: msg })
      setTimeout(() => setGroqStatus(null), 7000)
      return result

    } catch (err) {
      console.error('[useGroqRatesExtract]', err)
      setGroqStatus({ type: 'error', message: err.message || 'Failed to read image. Try a clearer photo.' })
      setTimeout(() => setGroqStatus(null), 8000)
      return null
    }
  }

  return { extractAndMap, groqStatus, clearGroqStatus: () => setGroqStatus(null) }
}
