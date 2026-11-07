import type { ComponentChildren } from "preact";
import type { Setup } from "../setup.js";

/** Home (plan §7, screen 3): this month's one action (the card, as children), then setup. Amount owed is step 6. */
export function Home(props: { setup: Setup; onSignOut: () => void; children?: ComponentChildren }) {
  const { org, tenancies } = props.setup;
  return (
    <main class="narrow">
      <h1>{org.name}</h1>
      <p>
        {tenancies.length === 0 ? "Add your first tenancy to start invoicing." : `${tenancies.length} ${tenancies.length === 1 ? "tenancy" : "tenancies"}.`}{" "}
        Each month Sasimem drafts your invoices and emails you one link to approve them. Nothing goes to a tenant until you approve.
      </p>
      {props.children}
      <a class="button" href="/tenancies/new">Add a tenancy</a>
      <nav aria-label="Setup">
        <ul class="links">
          <li><a href="/properties">Properties and units</a></li>
          <li><a href="/tenants">Tenants</a></li>
          <li><a href="/settings">Settings</a></li>
        </ul>
      </nav>
      <button type="button" class="quiet" onClick={props.onSignOut}>Sign out</button>
    </main>
  );
}
