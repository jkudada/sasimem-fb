/** The logo as SVG: the builder's live preview, from the same layout the export draws. */
import type { LogoDesign } from "@sasimem/core/logo";
import { LOGO_FONT_FACES } from "./fonts.js";
import { ICON_PATHS } from "./icons.js";
import type { LogoLayout } from "./layout.js";

export function LogoMark(props: { design: LogoDesign; layout: LogoLayout; class?: string }) {
  const { design: d, layout: l } = props;
  const face = LOGO_FONT_FACES[d.font];
  return (
    <svg class={props.class ?? "logo-preview"} viewBox={`0 0 ${l.width} ${l.height}`} role="img" aria-label={`Your logo: ${d.text}`}
      data-shape={d.shape} data-font={d.font} data-icon={d.icon}>
      {l.shape?.kind === "circle" && <circle cx={l.width / 2} cy={l.height / 2} r={l.shape.radius} fill={d.background} />}
      {l.shape?.kind === "rounded" && <rect width={l.width} height={l.height} rx={l.shape.radius} fill={d.background} />}
      {l.icon !== null && d.icon !== "none" && (
        <path data-part="icon" d={ICON_PATHS[d.icon]} fill={d.colour} fill-rule="evenodd"
          transform={`translate(${l.icon.x} ${l.icon.y}) scale(${l.icon.size / 24})`} />
      )}
      <text x={l.text.x} y={l.text.y} font-size={l.text.size} text-anchor={l.text.anchor} fill={d.colour}
        font-family={`"${face.family}", sans-serif`} font-weight={face.weight}>{d.text}</text>
    </svg>
  );
}
