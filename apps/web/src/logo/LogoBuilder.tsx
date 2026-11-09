/**
 * The logo builder (docs/PLAN-TEMPLATES.md §5): initials or a short name, a shape,
 * colours, a font and an icon, previewed live. Saving draws a PNG ≤ 400 px in the
 * browser and uploads it as the org's logo, keeping the choices to reopen with.
 * A lazy route: its fonts and code load only here.
 */
import { useSignal } from "@preact/signals";
import {
  type LogoDesign, type LogoFont, type LogoIcon, type LogoShape, LOGO_COLOURS, LOGO_FONTS, LOGO_ICONS, LOGO_SHAPES, MAX_LOGO_TEXT,
  defaultLogoDesign, logoDesignOf, logoDesignProblems,
} from "@sasimem/core/logo";
import { useEffect } from "preact/hooks";
import type { Org } from "../setup.js";
import { Back } from "../screens/Back.js";
import { Choice, Swatches } from "../screens/Choices.js";
import { Field, value } from "../screens/Field.js";
import { LOGO_FONT_FACES, loadLogoFonts } from "./fonts.js";
import { ICON_PATHS } from "./icons.js";
import { type Measure, estimate, logoLayout } from "./layout.js";
import { LogoMark } from "./LogoMark.js";
import { canvasMeasure, rasterise } from "./rasterise.js";

type Problems = ReturnType<typeof logoDesignProblems>;

export function LogoBuilder(props: {
  org: Org;
  onSave: (design: LogoDesign, png: Blob) => Promise<string | null>;
  onDone: () => void;
  /** The PNG drawing; tests pass a fake, as there is no canvas outside a browser. */
  draw?: (design: LogoDesign) => Promise<Blob>;
}) {
  const start = props.org.logoDesign ?? defaultLogoDesign(props.org.name);
  const text = useSignal(start.text);
  const shape = useSignal<LogoShape>(start.shape);
  const background = useSignal(start.background);
  const colour = useSignal(start.colour);
  const font = useSignal<LogoFont>(start.font);
  const icon = useSignal<LogoIcon>(start.icon);
  const measure = useSignal<Measure>(estimate);
  const problems = useSignal<Problems>({});
  const message = useSignal<string | null>(null);
  const busy = useSignal(false);

  // Measure with the real fonts once they are in; until then the preview estimates.
  useEffect(() => {
    let live = true;
    void loadLogoFonts().then(() => { if (live) measure.value = canvasMeasure(); });
    return () => { live = false; };
  }, []);

  const design = (): LogoDesign =>
    ({ text: text.value, shape: shape.value, background: background.value, colour: colour.value, font: font.value, icon: icon.value });

  const save = async (e: Event) => {
    e.preventDefault();
    const d = logoDesignOf(design());
    problems.value = logoDesignProblems(d);
    message.value = null;
    if (Object.keys(problems.value).length > 0) return;
    busy.value = true;
    try {
      const png = await (props.draw ?? rasterise)(d);
      message.value = await props.onSave(d, png);
    } catch (err) {
      message.value = err instanceof Error ? err.message : "The logo could not be made. Please try again.";
    }
    busy.value = false;
    if (message.value === null) props.onDone();
  };

  const d = design();
  const p = problems.value;
  return (
    <main class="narrow">
      <Back href="/settings" label="Settings" />
      <h1>Design a logo</h1>
      <LogoMark design={d} layout={logoLayout({ ...d, text: d.text.trim() === "" ? " " : d.text }, measure.value)} />
      <form onSubmit={save} noValidate>
        <Field label="Logo text" hint={`Your initials or a short name, up to ${MAX_LOGO_TEXT} characters.`} problem={p.text}>
          <input value={text} maxLength={MAX_LOGO_TEXT + 10} onInput={(e) => (text.value = value(e))} />
        </Field>
        <Choice legend="Shape" name="shape" options={LOGO_SHAPES} value={shape.value} onChange={(v) => (shape.value = v)} problem={p.shape} />
        {shape.value !== "none" && (
          <Swatches legend="Shape colour" name="background" colours={LOGO_COLOURS} value={background.value} onChange={(v) => (background.value = v)} problem={p.background} />
        )}
        <Swatches legend="Text colour" name="colour" colours={LOGO_COLOURS} value={colour.value} onChange={(v) => (colour.value = v)} problem={p.colour} />
        <Choice legend="Font" name="font" options={LOGO_FONTS} value={font.value} onChange={(v) => (font.value = v)} problem={p.font}
          render={(id, label) => <span style={{ fontFamily: `"${LOGO_FONT_FACES[id].family}", sans-serif`, fontWeight: LOGO_FONT_FACES[id].weight }}>{label}</span>} />
        <Choice legend="Icon" name="icon" options={LOGO_ICONS} value={icon.value} onChange={(v) => (icon.value = v)} problem={p.icon}
          render={(id, label) => (
            <>
              {id !== "none" && <svg class="logo-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={ICON_PATHS[id]} fill="currentColor" fill-rule="evenodd" /></svg>}
              {label}
            </>
          )} />
        {message.value !== null && <p role="alert">{message.value}</p>}
        <button type="submit" disabled={busy}>Save logo</button>
      </form>
      <p class="note">This replaces any logo you uploaded. It goes on invoices whose template shows your logo.</p>
    </main>
  );
}
