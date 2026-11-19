import { hasFeature } from "@sasimem/core";
import type { Setup } from "../setup.js";
import { Back } from "./Back.js";

export function Tenants(props: { setup: Setup }) {
  const { tenants } = props.setup;
  const business = hasFeature(props.setup.org, "oneOff");
  return (
    <main class="narrow">
      <Back href="/" label="Home" />
      <h1>{business ? "Tenants and customers" : "Tenants"}</h1>
      {tenants.length === 0 && <p>{business ? "No tenants or customers yet." : "No tenants yet."}</p>}
      <ul class="links">
        {tenants.map((t) => (
          <li key={t.id}>
            <a href={`/tenants/${t.id}`}>{t.name}</a>
            <span class="note">{t.email}</span>
          </li>
        ))}
      </ul>
      <a class="button" href="/tenants/new">{business ? "Add a customer" : "Add a tenant"}</a>
    </main>
  );
}
