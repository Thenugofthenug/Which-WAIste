import landfill from './assets/bins/landfill.png'
import recycling from './assets/bins/recycling.png'
import compost from './assets/bins/compost.png'

const bins = [
  { name: 'Recycling', image: recycling, color: '#75e5f5', symbol: 'recycling arrows' },
  { name: 'Compost', image: compost, color: '#b5e879', symbol: 'leaf' },
  { name: 'Landfill', image: landfill, color: '#ffac85', symbol: 'trash can' },
]

export default function HomeBins() {
  return <div className="home-bins" role="group" aria-label="The three sorting bins">
    {bins.map(bin => <figure key={bin.name}>
      <img src={bin.image} alt={`${bin.name} bin with a ${bin.symbol} symbol`} width="256" height="256" />
      <figcaption style={{ color: bin.color }}>{bin.name}</figcaption>
    </figure>)}
  </div>
}
