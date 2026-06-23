import { useEffect, useRef } from 'react'
import './CoreOrb.css'

export default function CoreOrb() {
  const canvasRef = useRef(null)
  const animRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let time = 0

    const particles = Array.from({ length: 60 }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.0003,
      vy: (Math.random() - 0.5) * 0.0003,
      size: 0.8 + Math.random() * 1.2,
    }))

    function resize() {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.scale(dpr, dpr)
    }

    function draw() {
      const w = canvas.getBoundingClientRect().width
      const h = canvas.getBoundingClientRect().height
      ctx.clearRect(0, 0, w, h)
      time++

      const breath = 0.5 + Math.sin(time * 0.008) * 0.2

      particles.forEach((p) => {
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0 || p.x > 1) p.vx *= -1
        if (p.y < 0 || p.y > 1) p.vy *= -1
        p.x = Math.max(0, Math.min(1, p.x))
        p.y = Math.max(0, Math.min(1, p.y))
      })

      const connectionDist = 0.15

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < connectionDist) {
            const alpha = (1 - dist / connectionDist) * 0.15 * breath
            ctx.beginPath()
            ctx.moveTo(particles[i].x * w, particles[i].y * h)
            ctx.lineTo(particles[j].x * w, particles[j].y * h)
            ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`
            ctx.lineWidth = 0.5
            ctx.stroke()
          }
        }
      }

      particles.forEach((p) => {
        const px = p.x * w
        const py = p.y * h
        ctx.beginPath()
        ctx.arc(px, py, p.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + breath * 0.4})`
        ctx.fill()
      })

      animRef.current = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    draw()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animRef.current)
    }
  }, [])

  return (
    <div className="core-orb">
      <canvas ref={canvasRef} className="core-orb__canvas" />
    </div>
  )
}
