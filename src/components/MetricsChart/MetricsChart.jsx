import { useEffect, useRef } from 'react'
import './MetricsChart.css'

export default function MetricsChart({ data }) {
  const pathRef = useRef(null)

  useEffect(() => {
    const path = pathRef.current
    if (!path) return
    const length = path.getTotalLength()
    path.style.strokeDasharray = length
    path.style.strokeDashoffset = length
    requestAnimationFrame(() => {
      path.style.transition = 'stroke-dashoffset 2s ease-out'
      path.style.strokeDashoffset = '0'
    })
  }, [])

  const width = 600
  const height = 200
  const padding = 30

  const maxVal = Math.max(...data.map(d => d.value))
  const minVal = Math.min(...data.map(d => d.value))
  const range = maxVal - minVal || 1

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2)
    const y = height - padding - ((d.value - minVal) / range) * (height - padding * 2)
    return { x, y }
  })

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')

  const gridLines = [0.25, 0.5, 0.75].map(pct => {
    const y = padding + pct * (height - padding * 2)
    return y
  })

  return (
    <div className="metrics-chart">
      <h3 className="metrics-chart__title">Throughput</h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="metrics-chart__svg">
        {gridLines.map((y, i) => (
          <line key={i} x1={padding} y1={y} x2={width - padding} y2={y} stroke="var(--bg-elevated)" strokeWidth="0.5" />
        ))}
        <path ref={pathRef} d={pathD} fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill="#000" stroke="#fff" strokeWidth="1" />
        ))}
      </svg>
      <div className="metrics-chart__labels">
        {data.map((d, i) => (
          <span key={i} className="metrics-chart__label">{d.time}</span>
        ))}
      </div>
    </div>
  )
}
