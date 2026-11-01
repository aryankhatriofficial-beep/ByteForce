/** PyVerify mark: a hexagonal "verified byte" — two interlocking chevrons around a digest core. */
export function LogoMark({ size = 28, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className={animated ? "logo-anim" : undefined}>
      <defs>
        <linearGradient id="pv-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eef3ff" />
          <stop offset="0.5" stopColor="#9d85ff" />
          <stop offset="1" stopColor="#ff4fd8" />
        </linearGradient>
      </defs>
      <path d="M20 2 35.6 11v18L20 38 4.4 29V11Z" fill="none" stroke="url(#pv-g)" strokeWidth="1.6" />
      <path d="M12 15.5 20 20l8-4.5M20 20v9.5" fill="none" stroke="#eef3ff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20" cy="20" r="2.2" fill="#5ef2c6" />
    </svg>
  );
}
