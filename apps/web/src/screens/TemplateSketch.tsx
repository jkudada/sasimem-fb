/**
 * A live sketch of an invoice template (docs/PLAN-TEMPLATES.md §4): the shapes and
 * colours of each layout, not the real PDF. It costs no network, so it can follow
 * every tap; "See a sample PDF" shows the real thing.
 */
import { type InvoiceTemplate, LAYOUTS, initials } from "@sasimem/core";

const INK = "#1c2321";
const MUTED = "#b9c2bf";

/** A grey bar standing for a line of text. */
const Bar = (p: { x: number; y: number; w: number; h?: number; fill?: string }) => <rect x={p.x} y={p.y} width={p.w} height={p.h ?? 3} rx="1" fill={p.fill ?? MUTED} />;

export function TemplateSketch(props: { template: InvoiceTemplate; orgName: string; hasLogo: boolean }) {
  const t = props.template;
  const family = t.font === "times" ? "Times New Roman, Times, serif" : "Helvetica, Arial, sans-serif";
  const mark = t.mark === "none" ? "none" : t.mark === "logo" && props.hasLogo ? "logo" : "monogram";
  const label = LAYOUTS.find((l) => l.id === t.layout)?.label ?? t.layout;
  const onBand = t.layout === "band";

  const markAt = (x: number, y: number, r: number) =>
    mark === "logo" ? <rect data-mark="logo" x={x} y={y} width={r * 3} height={r * 2} rx="2" fill={onBand ? "#fff" : "#dfe5e3"} stroke={onBand ? "none" : MUTED} />
      : mark === "monogram" ? (
        <g data-mark="monogram">
          <circle cx={x + r} cy={y + r} r={r} fill={onBand ? "#fff" : t.accent} />
          <text x={x + r} y={y + r + r * 0.35} font-size={r} text-anchor="middle" font-family={family} font-weight="700" fill={onBand ? t.accent : "#fff"}>{initials(props.orgName)}</text>
        </g>
      ) : null;

  const table = (top: number, gap: number, head: string) => (
    <g>
      <Bar x={16} y={top} w={30} fill={head} /><Bar x={176} y={top} w={18} fill={head} />
      <line x1="16" x2="194" y1={top + 6} y2={top + 6} stroke={MUTED} stroke-width="0.6" />
      {[0, 1, 2].map((i) => <g key={i}><Bar x={16} y={top + 11 + i * gap} w={60 - i * 10} fill={INK} /><Bar x={174} y={top + 11 + i * gap} w={20} fill={INK} /></g>)}
      <line x1="16" x2="194" y1={top + 12 + 3 * gap} y2={top + 12 + 3 * gap} stroke={MUTED} stroke-width="0.6" />
    </g>
  );

  const totals = (top: number, total: string) => (
    <g>
      <Bar x={140} y={top} w={20} /><Bar x={174} y={top} w={20} fill={INK} />
      <Bar x={140} y={top + 8} w={20} h={4} fill={total} /><Bar x={168} y={top + 8} w={26} h={4} fill={total} />
      {t.footer !== "" && <g data-note="yes"><Bar x={16} y={top} w={80} /><Bar x={16} y={top + 5} w={70} /></g>}
    </g>
  );

  const payment = (top: number, box: string | null, size: number) => (
    <g>
      <Bar x={16} y={top} w={30} /><Bar x={16} y={top + 7} w={50} fill={INK} />
      <Bar x={16} y={top + 16} w={size * 9} h={size} fill={INK} />
      {box !== null && <rect x={13} y={top + 13} width={size * 9 + 6} height={size + 6} rx="1.5" fill="none" stroke={box} stroke-width="0.8" />}
    </g>
  );

  return (
    <svg class="sketch" viewBox="0 0 210 297" role="img"
      aria-label={`Sketch of the ${label} layout`} data-layout={t.layout} data-accent={t.accent} data-font={t.font}>
      <rect width="210" height="297" fill="#fff" stroke={MUTED} />
      {t.layout === "classic" && (
        <g>
          {markAt(16, 16, 8)}
          <text x="194" y="21" font-size="7" text-anchor="end" font-family={family} font-weight="700" fill={INK}>{props.orgName}</text>
          <Bar x={150} y={25} w={44} /><Bar x={160} y={30} w={34} />
          <text x="16" y="56" font-size="9" font-family={family} font-weight="700" fill={INK}>INVOICE</text>
          {[0, 1, 2].map((i) => <Bar key={i} x={16} y={64 + i * 6} w={50} />)}
          <Bar x={110} y={64} w={20} /><Bar x={110} y={70} w={40} fill={INK} />
          {table(96, 10, MUTED)}{totals(146, INK)}{payment(172, null, 6)}
        </g>
      )}
      {t.layout === "band" && (
        <g>
          <rect width="210" height="44" fill={t.accent} />
          {markAt(16, 12, 10)}
          <text x="194" y="20" font-size="8" text-anchor="end" font-family={family} font-weight="700" fill="#fff">{props.orgName}</text>
          <Bar x={150} y={25} w={44} fill="#fff" /><Bar x={160} y={30} w={34} fill="#fff" />
          <text x="16" y="60" font-size="9" font-family={family} font-weight="700" fill={t.accent}>INVOICE</text>
          {[0, 1, 2].map((i) => <Bar key={i} x={16} y={68 + i * 6} w={50} />)}
          <Bar x={110} y={68} w={20} /><Bar x={110} y={74} w={40} fill={INK} />
          {table(100, 10, t.accent)}{totals(150, t.accent)}{payment(176, t.accent, 6)}
        </g>
      )}
      {t.layout === "compact" && (
        <g>
          {markAt(16, 14, 6)}
          <text x={mark === "none" ? 16 : mark === "logo" ? 38 : 32} y="20" font-size="6" font-family={family} font-weight="700" fill={INK}>{props.orgName}</text>
          <Bar x={mark === "none" ? 16 : mark === "logo" ? 38 : 32} y={23} w={50} />
          <text x="194" y="20" font-size="7" text-anchor="end" font-family={family} font-weight="700" fill={INK}>INVOICE</text>
          <line x1="16" x2="194" y1="34" y2="34" stroke={t.accent} stroke-width="1" />
          {[0, 1, 2, 3].map((i) => <g key={i}><Bar x={16 + i * 44} y={39} w={20} /><Bar x={16 + i * 44} y={44} w={32} fill={INK} /></g>)}
          <Bar x={16} y={54} w={16} /><Bar x={16} y={59} w={40} fill={INK} />
          {table(72, 8, MUTED)}{totals(112, INK)}{payment(132, null, 5)}
        </g>
      )}
    </svg>
  );
}
