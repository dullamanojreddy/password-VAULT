import { brandFor } from '../lib/brands'

export default function AppLogo({ name, size = 36 }) {
  const { Icon, color, isBrand } = brandFor(name)
  const iconSize = isBrand ? Math.round(size * 0.5) : Math.round(size * 0.42)
  return (
    <div
      className="grid shrink-0 place-items-center rounded-lg font-bold"
      style={{ width: size, height: size, background: color + '1f', color, fontSize: size * 0.4 }}
    >
      {isBrand ? <Icon size={iconSize} /> : (name?.[0]?.toUpperCase() ?? <Icon size={iconSize} />)}
    </div>
  )
}
