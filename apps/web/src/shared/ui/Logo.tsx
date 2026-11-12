// Logo original del software: una "F" de Facturación cuya barra superior
// termina en punta de flecha (crecimiento), sobre un degradado azul → verde
// con los colores de la app (#438dff → #43d5a5). SVG vectorial, sin archivos.
export function Logo({ size = 38, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  return (
    <span className="logo">
      <svg
        className="logo__mark"
        width={size}
        height={size}
        viewBox="0 0 40 40"
        role="img"
        aria-label="Facturación"
      >
        <defs>
          <linearGradient id="factu-logo-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#438dff" />
            <stop offset="100%" stopColor="#43d5a5" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="38" height="38" rx="10" fill="url(#factu-logo-grad)" />
        <g fill="#fff">
          <rect x="11" y="11" width="4.5" height="18" rx="1.5" />
          <rect x="11" y="11" width="14" height="4.5" rx="1.5" />
          <path d="M25 8.5 L31.5 13.25 L25 18 Z" />
          <rect x="11" y="19.5" width="11" height="4.5" rx="1.5" />
        </g>
      </svg>
      {withWordmark && (
        <span className="logo__word">
          <strong>Facturación</strong>
          <span>PLATAFORMA</span>
        </span>
      )}
    </span>
  );
}
