import type { Setup } from "../setup.js";
import { Back } from "./Back.js";

export function Tenants(props: { setup: Setup }) {
  const { tenants } = props.setup;
  return (
    <main class="narrow">
      <Back href="/" label="Home" />
      <h1>Tenants</h1>
      {tenants.length === 0 && <p>No tenants yet.</p>}
      <ul class="links">
        {tenants.map((t) => (
          <li key={t.id}>
            <a href={`/tenants/${t.id}`}>{t.name}</a>
            <span class="note">{t.email}</span>
          </li>
        ))}
      </ul>
      <a class="button" href="/tenants/new">Add a tenant</a>
    </main>
  );
}
