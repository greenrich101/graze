import { useState } from 'react'
import { supabase } from '../lib/supabase'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const WINDOWS = [7, 30, 90, 365]

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000)
}

function fmt(date) {
  return new Date(date + 'T00:00').toLocaleDateString()
}

export default function GenerateReport({ propertyId }) {
  const [generating, setGenerating] = useState(null)

  const generate = async (days) => {
    setGenerating(days)

    try {
      const now = new Date()
      const cutoff = new Date(now)
      cutoff.setDate(cutoff.getDate() - days)
      const cutoffStr = cutoff.toISOString().split('T')[0]
      const nowStr = now.toISOString().split('T')[0]

      // Previous window for trend comparison
      const prevCutoff = new Date(cutoff)
      prevCutoff.setDate(prevCutoff.getDate() - days)
      const prevCutoffStr = prevCutoff.toISOString().split('T')[0]

      // --- Fetch all data in parallel ---
      const [
        { data: mobs },
        { data: paddocks },
        { data: allMovements },
        { data: animalEvents },
        { data: healthEvents },
        { data: animals },
        { data: prevHealthEvents },
      ] = await Promise.all([
        supabase.from('mobs').select('*, mob_composition(*)').eq('property_id', propertyId),
        supabase.from('paddocks').select('*').eq('property_id', propertyId),
        supabase.from('movements').select('*'),
        supabase.from('animal_events').select('*').gte('event_date', cutoffStr),
        supabase.from('health_events').select('*').gte('treatment_date', cutoffStr),
        supabase.from('animals').select('*'),
        supabase.from('health_events').select('*').gte('treatment_date', prevCutoffStr).lt('treatment_date', cutoffStr),
      ])

      // Filter movements to property mobs
      const mobNames = new Set((mobs || []).map((m) => m.name))
      const propertyMovements = (allMovements || []).filter((m) => mobNames.has(m.mob_name))
      const propertyAnimals = (animals || []).filter((a) => mobNames.has(a.mob_name))
      const propertyHealth = (healthEvents || []).filter((h) => mobNames.has(h.mob_name))
      const propertyPrevHealth = (prevHealthEvents || []).filter((h) => mobNames.has(h.mob_name))
      const propertyEvents = (animalEvents || []).filter((e) => mobNames.has(e.mob_name))

      // Completed movements within window
      const completedInWindow = propertyMovements.filter(
        (m) => m.actual_move_out_date && m.actual_move_out_date >= cutoffStr
      )

      // Active movements (currently grazing)
      const activeMovements = propertyMovements.filter(
        (m) => m.actual_move_in_date && !m.actual_move_out_date
      )

      // --- Build PDF ---
      const doc = new jsPDF()
      let y = 20

      // Title
      doc.setFontSize(18)
      doc.text('Property Report', 14, y)
      y += 8
      doc.setFontSize(10)
      doc.text(`${fmt(cutoffStr)} — ${fmt(nowStr)}  (${days} days)`, 14, y)
      y += 4
      doc.text(`Generated: ${now.toLocaleString()}`, 14, y)
      y += 10

      // ========== 1. GRAZING & MOVEMENT ==========
      doc.setFontSize(14)
      doc.text('1. Grazing & Movement', 14, y)
      y += 8

      // Days each mob spent in each paddock
      doc.setFontSize(11)
      doc.text('Days per paddock', 14, y)
      y += 5
      const mobPaddockDays = {}
      completedInWindow.forEach((m) => {
        const dur = daysBetween(m.actual_move_in_date, m.actual_move_out_date)
        const key = `${m.mob_name}|${m.paddock_name}`
        mobPaddockDays[key] = (mobPaddockDays[key] || 0) + dur
      })
      // Include active movements too
      activeMovements.forEach((m) => {
        const dur = daysBetween(m.actual_move_in_date, nowStr)
        const key = `${m.mob_name}|${m.paddock_name}`
        mobPaddockDays[key] = (mobPaddockDays[key] || 0) + dur
      })
      const daysRows = Object.entries(mobPaddockDays)
        .sort(([, a], [, b]) => b - a)
        .map(([key, d]) => {
          const [mob, paddock] = key.split('|')
          return [mob, paddock, d]
        })
      if (daysRows.length > 0) {
        autoTable(doc, {
          startY: y,
          head: [['Mob', 'Paddock', 'Days']],
          body: daysRows,
          theme: 'grid',
          styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.25 },
          headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
          margin: { left: 14 },
        })
        y = doc.lastAutoTable.finalY + 8
      } else {
        doc.setFontSize(9)
        doc.text('No movement data in window.', 14, y + 4)
        y += 12
      }

      // Last move date + days since
      doc.setFontSize(11)
      doc.text('Last move per mob', 14, y)
      y += 5
      const lastMoveByMob = {}
      propertyMovements.forEach((m) => {
        if (m.actual_move_in_date) {
          if (!lastMoveByMob[m.mob_name] || m.actual_move_in_date > lastMoveByMob[m.mob_name]) {
            lastMoveByMob[m.mob_name] = m.actual_move_in_date
          }
        }
      })
      const lastMoveRows = (mobs || []).map((mob) => {
        const last = lastMoveByMob[mob.name]
        return [mob.name, last ? fmt(last) : 'Never', last ? daysBetween(last, nowStr) : '—']
      })
      autoTable(doc, {
        startY: y,
        head: [['Mob', 'Last Move', 'Days Since']],
        body: lastMoveRows,
        theme: 'grid',
        styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.25 },
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
        margin: { left: 14 },
      })
      y = doc.lastAutoTable.finalY + 8

      // Paddocks not grazed
      doc.setFontSize(11)
      doc.text(`Paddocks not grazed in ${days} days`, 14, y)
      y += 5
      const grazedPaddocks = new Set()
      propertyMovements.forEach((m) => {
        if (m.actual_move_in_date && m.actual_move_in_date >= cutoffStr) {
          grazedPaddocks.add(m.paddock_name)
        }
      })
      activeMovements.forEach((m) => grazedPaddocks.add(m.paddock_name))
      const ungrazed = (paddocks || []).filter((p) => !grazedPaddocks.has(p.name))
      if (ungrazed.length > 0) {
        autoTable(doc, {
          startY: y,
          head: [['Paddock', 'Size (acres)']],
          body: ungrazed.map((p) => [p.name, p.area_acres || '—']),
          theme: 'grid',
          styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.25 },
          headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
          margin: { left: 14 },
        })
        y = doc.lastAutoTable.finalY + 8
      } else {
        doc.setFontSize(9)
        doc.text('All paddocks grazed within window.', 14, y + 4)
        y += 12
      }

      // Over-used vs under-used paddocks
      doc.setFontSize(11)
      doc.text('Paddock usage', 14, y)
      y += 5
      const paddockUseCount = {}
      ;(paddocks || []).forEach((p) => { paddockUseCount[p.name] = 0 })
      propertyMovements.forEach((m) => {
        if (m.actual_move_in_date && m.actual_move_in_date >= cutoffStr) {
          paddockUseCount[m.paddock_name] = (paddockUseCount[m.paddock_name] || 0) + 1
        }
      })
      const usageRows = Object.entries(paddockUseCount)
        .sort(([, a], [, b]) => b - a)
        .map(([name, count]) => [name, count])
      autoTable(doc, {
        startY: y,
        head: [['Paddock', 'Moves In (window)']],
        body: usageRows,
        theme: 'grid',
        styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.25 },
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
        margin: { left: 14 },
      })
      y = doc.lastAutoTable.finalY + 10

      // New page check
      if (y > 240) { doc.addPage(); y = 20 }

      // ========== 2. STOCK NUMBERS ==========
      doc.setFontSize(14)
      doc.text('2. Stock Numbers', 14, y)
      y += 8

      // Head count by mob
      doc.setFontSize(11)
      doc.text('Head count by mob', 14, y)
      y += 5
      const stockRows = (mobs || []).map((mob) => {
        const total = (mob.mob_composition || []).reduce((s, c) => s + c.count, 0)
        const breakdown = (mob.mob_composition || [])
          .filter((c) => c.count > 0)
          .map((c) => `${c.count} ${c.cattle_type}`)
          .join(', ')
        return [mob.name, total, breakdown]
      })
      const totalHead = (mobs || []).reduce(
        (s, m) => s + (m.mob_composition || []).reduce((s2, c) => s2 + c.count, 0), 0
      )
      stockRows.push(['TOTAL', totalHead, ''])
      autoTable(doc, {
        startY: y,
        head: [['Mob', 'Head', 'Breakdown']],
        body: stockRows,
        theme: 'grid',
        styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.25 },
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
        margin: { left: 14 },
      })
      y = doc.lastAutoTable.finalY + 8

      // Net change
      doc.setFontSize(11)
      doc.text('Net change (window)', 14, y)
      y += 5
      const eventCounts = {}
      propertyEvents.forEach((e) => {
        eventCounts[e.event_type] = (eventCounts[e.event_type] || 0) + (e.count || 1)
      })
      const changeRows = Object.entries(eventCounts).map(([type, count]) => [type, `-${count}`])
      if (changeRows.length > 0) {
        autoTable(doc, {
          startY: y,
          head: [['Event', 'Count']],
          body: changeRows,
          theme: 'grid',
          styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.25 },
          headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
          margin: { left: 14 },
        })
        y = doc.lastAutoTable.finalY + 8
      } else {
        doc.setFontSize(9)
        doc.text('No sold/deceased events in window.', 14, y + 4)
        y += 12
      }

      // Stocking rate
      doc.setFontSize(11)
      doc.text('Stocking rate (current)', 14, y)
      y += 5
      const mobHeadMap = {}
      ;(mobs || []).forEach((mob) => {
        mobHeadMap[mob.name] = (mob.mob_composition || []).reduce((s, c) => s + c.count, 0)
      })
      const paddockAreaMap = {}
      ;(paddocks || []).forEach((p) => { paddockAreaMap[p.name] = p.area_acres })
      const stockingRows = activeMovements.map((m) => {
        const head = mobHeadMap[m.mob_name] || 0
        const acres = paddockAreaMap[m.paddock_name]
        const rate = acres ? (head / acres).toFixed(2) : '—'
        return [m.paddock_name, m.mob_name, head, acres || '—', rate]
      })
      if (stockingRows.length > 0) {
        autoTable(doc, {
          startY: y,
          head: [['Paddock', 'Mob', 'Head', 'Acres', 'Head/Acre']],
          body: stockingRows,
          theme: 'grid',
          styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.25 },
          headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
          margin: { left: 14 },
        })
        y = doc.lastAutoTable.finalY + 10
      } else {
        doc.setFontSize(9)
        doc.text('No active grazing.', 14, y + 4)
        y += 12
      }

      if (y > 240) { doc.addPage(); y = 20 }

      // ========== 3. HEALTH SUMMARY ==========
      doc.setFontSize(14)
      doc.text('3. Health Summary', 14, y)
      y += 8

      // Events per mob
      doc.setFontSize(11)
      doc.text('Health events per mob', 14, y)
      y += 5
      const healthByMob = {}
      propertyHealth.forEach((h) => {
        healthByMob[h.mob_name] = (healthByMob[h.mob_name] || 0) + 1
      })
      const healthMobRows = (mobs || []).map((m) => [m.name, healthByMob[m.name] || 0])
      autoTable(doc, {
        startY: y,
        head: [['Mob', 'Events']],
        body: healthMobRows,
        theme: 'grid',
        styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.25 },
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
        margin: { left: 14 },
      })
      y = doc.lastAutoTable.finalY + 8

      // Treated vs untreated
      doc.setFontSize(11)
      doc.text('Animals treated vs untreated', 14, y)
      y += 5
      const treatedByMob = {}
      propertyHealth.forEach((h) => {
        if (!treatedByMob[h.mob_name]) treatedByMob[h.mob_name] = new Set()
        treatedByMob[h.mob_name].add(h.animal_id)
      })
      const animalsByMob = {}
      propertyAnimals.forEach((a) => {
        if (a.status === 'alive') {
          animalsByMob[a.mob_name] = (animalsByMob[a.mob_name] || 0) + 1
        }
      })
      const treatedRows = (mobs || []).map((m) => {
        const treated = treatedByMob[m.name]?.size || 0
        const total = animalsByMob[m.name] || 0
        return [m.name, treated, total - treated, total]
      })
      autoTable(doc, {
        startY: y,
        head: [['Mob', 'Treated', 'Untreated', 'Total']],
        body: treatedRows,
        theme: 'grid',
        styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.25 },
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
        margin: { left: 14 },
      })
      y = doc.lastAutoTable.finalY + 8

      // Repeated issues
      doc.setFontSize(11)
      doc.text('Repeated issues (animal treated 2+ times)', 14, y)
      y += 5
      const animalTreatCount = {}
      propertyHealth.forEach((h) => {
        animalTreatCount[h.animal_id] = (animalTreatCount[h.animal_id] || 0) + 1
      })
      const repeatedIds = Object.entries(animalTreatCount)
        .filter(([, c]) => c >= 2)
        .map(([id, c]) => ({ id, count: c }))
      if (repeatedIds.length > 0) {
        const repeatedRows = repeatedIds.map((r) => {
          const animal = propertyAnimals.find((a) => a.id === r.id)
          return [
            animal?.management_tag || animal?.nlis_tag || r.id.slice(0, 8),
            animal?.mob_name || '—',
            animal?.cattle_type || '—',
            r.count,
          ]
        })
        autoTable(doc, {
          startY: y,
          head: [['Animal', 'Mob', 'Type', 'Treatments']],
          body: repeatedRows,
          theme: 'grid',
          styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.25 },
          headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
          margin: { left: 14 },
        })
        y = doc.lastAutoTable.finalY + 8
      } else {
        doc.setFontSize(9)
        doc.text('No repeated treatments.', 14, y + 4)
        y += 12
      }

      // Days since last treatment by mob
      doc.setFontSize(11)
      doc.text('Days since last treatment', 14, y)
      y += 5
      const lastTreatByMob = {}
      propertyHealth.forEach((h) => {
        if (!lastTreatByMob[h.mob_name] || h.treatment_date > lastTreatByMob[h.mob_name]) {
          lastTreatByMob[h.mob_name] = h.treatment_date
        }
      })
      const lastTreatRows = (mobs || []).map((m) => {
        const last = lastTreatByMob[m.name]
        return [m.name, last ? fmt(last) : 'Never', last ? daysBetween(last, nowStr) : '—']
      })
      autoTable(doc, {
        startY: y,
        head: [['Mob', 'Last Treatment', 'Days Since']],
        body: lastTreatRows,
        theme: 'grid',
        styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.25 },
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
        margin: { left: 14 },
      })
      y = doc.lastAutoTable.finalY + 10

      if (y > 240) { doc.addPage(); y = 20 }

      // ========== 4. EXCEPTIONS ==========
      doc.setFontSize(14)
      doc.text('4. Exceptions', 14, y)
      y += 8

      // Mobs not moved in X days
      doc.setFontSize(11)
      doc.text(`Mobs not moved in ${days} days`, 14, y)
      y += 5
      const staleMobs = (mobs || []).filter((m) => {
        const last = lastMoveByMob[m.name]
        return !last || last < cutoffStr
      })
      if (staleMobs.length > 0) {
        autoTable(doc, {
          startY: y,
          head: [['Mob', 'Last Move', 'Days Since']],
          body: staleMobs.map((m) => {
            const last = lastMoveByMob[m.name]
            return [m.name, last ? fmt(last) : 'Never', last ? daysBetween(last, nowStr) : '—']
          }),
          theme: 'grid',
          styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.25 },
          headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
          margin: { left: 14 },
        })
        y = doc.lastAutoTable.finalY + 8
      } else {
        doc.setFontSize(9)
        doc.text('All mobs moved within window.', 14, y + 4)
        y += 12
      }

      // Animals with no movement history
      doc.setFontSize(11)
      doc.text('Animals in mobs with no movement history', 14, y)
      y += 5
      const mobsWithMoves = new Set(propertyMovements.map((m) => m.mob_name))
      const noMoveMobs = (mobs || []).filter((m) => !mobsWithMoves.has(m.name))
      if (noMoveMobs.length > 0) {
        const noMoveCount = noMoveMobs.map((m) => {
          const count = propertyAnimals.filter((a) => a.mob_name === m.name && a.status === 'alive').length
          return [m.name, count]
        })
        autoTable(doc, {
          startY: y,
          head: [['Mob (no moves)', 'Animals']],
          body: noMoveCount,
          theme: 'grid',
          styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.25 },
          headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
          margin: { left: 14 },
        })
        y = doc.lastAutoTable.finalY + 8
      } else {
        doc.setFontSize(9)
        doc.text('All mobs have movement history.', 14, y + 4)
        y += 12
      }

      // Health records missing notes
      doc.setFontSize(11)
      doc.text('Health records missing notes', 14, y)
      y += 5
      const missingNotes = propertyHealth.filter((h) => !h.notes)
      doc.setFontSize(9)
      doc.text(`${missingNotes.length} of ${propertyHealth.length} health events have no notes.`, 14, y + 4)
      y += 8

      // Data inconsistencies
      doc.setFontSize(11)
      doc.text('Data inconsistencies', 14, y)
      y += 5
      const inconsistencies = []
      ;(mobs || []).forEach((mob) => {
        const compCount = (mob.mob_composition || []).reduce((s, c) => s + c.count, 0)
        const actualCount = propertyAnimals.filter(
          (a) => a.mob_name === mob.name && a.status === 'alive'
        ).length
        if (compCount !== actualCount) {
          inconsistencies.push([mob.name, compCount, actualCount, compCount - actualCount])
        }
      })
      if (inconsistencies.length > 0) {
        autoTable(doc, {
          startY: y,
          head: [['Mob', 'Composition Count', 'Actual Animals', 'Difference']],
          body: inconsistencies,
          theme: 'grid',
          styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.25 },
          headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
          margin: { left: 14 },
        })
        y = doc.lastAutoTable.finalY + 10
      } else {
        doc.setFontSize(9)
        doc.text('No inconsistencies found.', 14, y + 4)
        y += 12
      }

      if (y > 240) { doc.addPage(); y = 20 }

      // ========== 5. SIMPLE KPIs ==========
      doc.setFontSize(14)
      doc.text('5. Simple KPIs', 14, y)
      y += 8

      // Avg days per paddock
      const durations = completedInWindow.map((m) =>
        daysBetween(m.actual_move_in_date, m.actual_move_out_date)
      )
      const avgDays = durations.length > 0
        ? (durations.reduce((s, d) => s + d, 0) / durations.length).toFixed(1)
        : '—'

      // % paddocks rested > 30 days
      const totalPaddocks = (paddocks || []).length
      const restedCount = ungrazed.length
      const restedPct = totalPaddocks > 0 ? ((restedCount / totalPaddocks) * 100).toFixed(0) : '—'

      // Health events per 100 head
      const per100 = totalHead > 0
        ? ((propertyHealth.length / totalHead) * 100).toFixed(1)
        : '—'

      // Treatments per mob (current vs previous)
      const prevByMob = {}
      propertyPrevHealth.forEach((h) => {
        prevByMob[h.mob_name] = (prevByMob[h.mob_name] || 0) + 1
      })
      const trendRows = (mobs || []).map((m) => {
        const current = healthByMob[m.name] || 0
        const prev = prevByMob[m.name] || 0
        let trend = '—'
        if (prev > 0) {
          const change = ((current - prev) / prev * 100).toFixed(0)
          trend = change > 0 ? `+${change}%` : `${change}%`
        } else if (current > 0) {
          trend = 'New'
        }
        return [m.name, current, prev, trend]
      })

      autoTable(doc, {
        startY: y,
        head: [['KPI', 'Value']],
        body: [
          ['Avg days per paddock', avgDays],
          [`% paddocks rested (not grazed in ${days}d)`, `${restedPct}%`],
          ['Health events per 100 head', per100],
        ],
        theme: 'grid',
        styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.25 },
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
        margin: { left: 14 },
      })
      y = doc.lastAutoTable.finalY + 8

      doc.setFontSize(11)
      doc.text('Treatments per mob (current vs previous window)', 14, y)
      y += 5
      autoTable(doc, {
        startY: y,
        head: [['Mob', `Current (${days}d)`, `Previous (${days}d)`, 'Trend']],
        body: trendRows,
        theme: 'grid',
        styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.25 },
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
        margin: { left: 14 },
      })

      // Save
      doc.save(`graze-report-${days}d-${nowStr}.pdf`)
    } catch (err) {
      console.error('Report generation error:', err)
      alert('Failed to generate report: ' + err.message)
    } finally {
      setGenerating(null)
    }
  }

  return (
    <div className="detail-card" style={{ marginTop: '2rem' }}>
      <h3>Generate Report</h3>
      <p className="muted" style={{ marginBottom: '0.75rem', fontSize: '0.875rem' }}>
        Download a PDF report covering grazing, stock, health, exceptions, and KPIs.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {WINDOWS.map((d) => (
          <button
            key={d}
            className="btn btn-secondary"
            onClick={() => generate(d)}
            disabled={generating !== null}
          >
            {generating === d ? 'Generating...' : `${d} Days`}
          </button>
        ))}
      </div>
    </div>
  )
}
