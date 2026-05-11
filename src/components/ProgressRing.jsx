export default function ProgressRing({ percent = 0, size = 72, stroke = 6, color = "var(--accent)" }) {
  const r      = (size - stroke) / 2;
  const circ   = 2 * Math.PI * r;
  const offset = circ - (Math.min(percent, 100) / 100) * circ;

  return (
    <svg width={size} height={size} className="progress-ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" className="progress-ring__circle"
      />
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central" className="progress-ring__text">
        {Math.round(percent)}%
      </text>
    </svg>
  );
}
