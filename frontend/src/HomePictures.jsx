import { useEffect, useState } from 'react'
import items from './assets/waste/catalog'

const BACKGROUNDS = ['#105710', '#1d5e91', '#3c4142']

function nextPictures(previous = { pictures: [], backgrounds: {} }) {
  const pool = items.filter(item => !previous.pictures.some(picture => picture.name === item.name))
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const backgrounds = { ...previous.backgrounds }
  const pictures = pool.slice(0, 6).map(item => {
    const choices = BACKGROUNDS.filter(color => color !== backgrounds[item.name])
    const background = choices[Math.floor(Math.random() * choices.length)]
    backgrounds[item.name] = background
    return { ...item, background }
  })
  return { pictures, backgrounds }
}

export default function HomePictures() {
  const [gallery, setPictures] = useState(() => nextPictures())
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const timer = setInterval(() => {
      if (!document.hidden) setPictures(current => nextPictures(current))
    }, 750)
    return () => clearInterval(timer)
  }, [])

  return <div className="home-gallery">
    <div className="home-pictures" aria-label="Items from the sorting game">{gallery.pictures.map((item, slot) => {
      return <figure key={slot}><img src={item.image} alt={item.name} width="128" height="128" style={{ backgroundColor: item.background }} /><figcaption>{item.name}</figcaption></figure>
    })}</div>
  </div>
}
