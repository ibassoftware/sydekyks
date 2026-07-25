export type IconName =
  | 'alert'
  | 'bolt'
  | 'check'
  | 'chevron-down'
  | 'chat'
  | 'clock'
  | 'close'
  | 'database'
  | 'document'
  | 'external'
  | 'menu'
  | 'mail'
  | 'paperclip'
  | 'plus'
  | 'plug'
  | 'refresh'
  | 'send'
  | 'shield'
  | 'sparkles'
  | 'stop'
  | 'trash'
  | 'users'

export function Icon({ name, size = 20 }: { name: IconName; size?: number }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {name === 'menu' && <path d="M4 7h16M4 12h16M4 17h16" />}
      {name === 'close' && <path d="m7 7 10 10M17 7 7 17" />}
      {name === 'plus' && <path d="M12 5v14M5 12h14" />}
      {name === 'chat' && <path d="M5 5.5h14v10H9l-4 3v-13Z" />}
      {name === 'mail' && <path d="M3.5 6h17v12h-17V6Zm.5.5 8 6 8-6" />}
      {name === 'paperclip' && (
        <path d="m9 12.5 5.2-5.2a3 3 0 0 1 4.2 4.2l-7 7a5 5 0 0 1-7.1-7.1l7.4-7.4M7 14.8l7.2-7.2" />
      )}
      {name === 'bolt' && <path d="m13 2-8 12h6l-1 8 9-13h-6V2Z" />}
      {name === 'users' && (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19c.4-3.2 2.2-5 5.5-5s5.1 1.8 5.5 5M15.5 5.5a3 3 0 0 1 0 5.8M16 14c2.7.2 4.2 1.8 4.5 4.5" />
        </>
      )}
      {name === 'plug' && <path d="M8 3v5M16 3v5M6 8h12v2a6 6 0 0 1-6 6v5M9 21h6" />}
      {name === 'sparkles' && (
        <>
          <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z" />
          <path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" />
        </>
      )}
      {name === 'send' && <path d="m4 4 17 8-17 8 3-8-3-8Zm3 8h14" />}
      {name === 'stop' && <rect height="10" rx="2" width="10" x="7" y="7" />}
      {name === 'check' && <path d="m5 12.5 4.2 4.2L19 7" />}
      {name === 'alert' && (
        <>
          <path d="M12 3 2.8 20h18.4L12 3Z" />
          <path d="M12 9v5M12 17.5v.1" />
        </>
      )}
      {name === 'clock' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      )}
      {name === 'database' && (
        <>
          <ellipse cx="12" cy="5" rx="7.5" ry="3" />
          <path d="M4.5 5v7c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V5M4.5 12v7c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-7" />
        </>
      )}
      {name === 'shield' && <path d="M12 3 5 6v5c0 4.7 2.6 8 7 10 4.4-2 7-5.3 7-10V6l-7-3Z" />}
      {name === 'document' && <path d="M6 3h8l4 4v14H6V3Zm8 0v5h5M9 12h6M9 16h6" />}
      {name === 'external' && <path d="M13 5h6v6M19 5l-8 8M10 7H5v12h12v-5" />}
      {name === 'trash' && <path d="M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" />}
      {name === 'refresh' && (
        <path d="M20 7v5h-5M4 17v-5h5M18.5 12A6.5 6.5 0 0 0 7 8M5.5 12A6.5 6.5 0 0 0 17 16" />
      )}
      {name === 'chevron-down' && <path d="m7 10 5 5 5-5" />}
    </svg>
  )
}
