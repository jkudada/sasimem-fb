import { type CalendarDate, formatKina, type Toea } from "@sasimem/core";
import type { ComponentChildren } from "preact";
import type { Setup } from "../setup.js";
import { Icon, type IconName } from "./icons.js";
import { SubscriptionBanner } from "./SubscriptionBanner.js";

/** Home's menu: where each part of the app is, in a word or two, with what it holds underneath. */
const MENU: readonly { href: string; icon: IconName; title: string; hint: string }[] = [
  { href: "/invoices", icon: "invoices", title: "Invoices", hint: "Every month's invoices, and a CSV export" },
  { href: "/properties", icon: "properties", title: "Properties and units", hint: "Addresses, units and who rents each" },
  { href: "/tenants", icon: "tenants", title: "Tenants", hint: "Who you invoice, and their email" },
  { href: "/settings", icon: "settings", title: "Settings", hint: "Your details, logo, invoice look and plan" },
];

/** Home (plan §7, screen 3): this month's one action (the card, as children), the amount owed, then setup. */
/** today: shows the subscription banner (PLAN-SUBSCRIBERS §8) when there is one. */
export function Home(props: { setup: Setup; today?: CalendarDate; owedToea?: number; onSignOut: () => void; children?: ComponentChildren }) {
  const { org, tenancies } = props.setup;
  const owed = props.owedToea !== undefined && props.owedToea > 0 ? props.owedToea : null;
  return (
    <main class="narrow home">
      <header class="hero">
        <div>
          <p class="eyebrow">Your rentals</p>
          <h1>{org.name}</h1>
        </div>
        <button type="button" class="quiet small sign-out" onClick={props.onSignOut}><Icon name="signOut" />Sign out</button>
      </header>
      {props.today !== undefined && <SubscriptionBanner setup={props.setup} today={props.today} />}
      <p class="lede">
        {tenancies.length === 0 && "Add your first tenancy to start invoicing. "}
        Each month Sasimem drafts your invoices and emails you one link to approve them. Nothing goes to a tenant until you approve.
      </p>
      <div class="dash">
        <div class="dash-month">{props.children}</div>
        <div class="dash-side">
          <div class="stat">
            <span class="stat-value">{tenancies.length}</span>
            <span class="stat-label">{tenancies.length === 1 ? "tenancy" : "tenancies"}</span>
          </div>
          {owed !== null && (
            <a class="stat owed" href="/owed">
              <span class="stat-value">{formatKina(owed as Toea)}</span>{" "}
              <span class="stat-label">owed across all months</span>
            </a>
          )}
          <a class="button" href="/tenancies/new"><Icon name="plus" />Add a tenancy</a>
        </div>
      </div>
      <h2 class="section-title">Manage</h2>
      <nav aria-label="Invoices and setup">
        <ul class="tiles">
          {MENU.map((m) => (
            <li key={m.href}>
              <a class="tile" href={m.href} aria-labelledby={`menu-${m.icon}`} aria-describedby={`menu-${m.icon}-hint`}>
                <span class="tile-icon"><Icon name={m.icon} /></span>
                <span class="tile-text">
                  <span class="tile-title" id={`menu-${m.icon}`}>{m.title}</span>
                  <span class="tile-hint" id={`menu-${m.icon}-hint`}>{m.hint}</span>
                </span>
                <Icon name="arrow" class="tile-go" />
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
