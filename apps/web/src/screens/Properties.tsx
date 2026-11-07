import { type CalendarDate, tenancyState } from "@sasimem/core";
import type { Setup } from "../setup.js";
import { Back } from "./Back.js";

const STATE_WORDS = {
  upcoming: (t: { startDate: string }) => `starts ${t.startDate}`,
  current: () => "renting now",
  ended: (t: { endDate: string | null }) => `ended ${t.endDate ?? ""}`,
} as const;

/** Each property, its units, and who rents each unit (plan §7, screen 4). */
export function Properties(props: { setup: Setup; today: CalendarDate }) {
  const { properties, tenancies } = props.setup;
  return (
    <main class="narrow">
      <Back href="/" label="Home" />
      <h1>Properties</h1>
      {properties.length === 0 && <p>No properties yet.</p>}
      {properties.map((p) => (
        <section key={p.id} aria-labelledby={`property-${p.id}`} class="card">
          <h2 id={`property-${p.id}`}>{p.address}</h2>
          <p class="note">{p.useType === "commercial" ? "A business uses it" : "Someone lives there"} · <a href={`/properties/${p.id}`}>Edit</a></p>
          <ul class="units">
            {p.units.map((u) => {
              const here = tenancies.filter((t) => t.propertyId === p.id && t.unitId === u.id);
              return (
                <li key={u.id}>
                  <strong>{u.label}</strong>
                  {here.length === 0 && <span class="note"> · no tenancy</span>}
                  {here.map((t) => {
                    const state = tenancyState(t, props.today);
                    return (
                      <span key={t.id}> · <a href={`/tenancies/${t.id}`}>{t.tenantName}</a> <span class={`state ${state}`}>{STATE_WORDS[state](t)}</span></span>
                    );
                  })}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <a class="button" href="/properties/new">Add a property</a>
    </main>
  );
}
