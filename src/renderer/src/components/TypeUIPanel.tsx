import { useState } from 'react'
import typeuiLogo from '../assets/typeui-logo.svg'
import { Icon } from './Icon'

export function TypeUIPanel(): React.JSX.Element {
  const [minimized, setMinimized] = useState(true)
  if (minimized) {
    return (
      <button
        aria-label="Show TypeUI design marker"
        className="typeui-marker typeui-marker-minimized"
        onClick={() => setMinimized(false)}
        type="button"
      >
        <img alt="" height="18" src={typeuiLogo} width="18" />
      </button>
    )
  }
  return (
    <div className="typeui-marker">
      <img alt="" height="18" src={typeuiLogo} width="18" />
      <span>TypeUI</span>
      <button
        aria-label="Hide TypeUI design marker"
        onClick={() => setMinimized(true)}
        type="button"
      >
        <Icon name="chevron-down" size={16} />
      </button>
    </div>
  )
}
