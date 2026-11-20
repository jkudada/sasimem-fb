import { type CalendarDate, formatKina, hasFeature, type Toea } from "@sasimem/core";
import type { ComponentChildren } from "preact";
import type { Setup } from "../setup.js";
import { Icon, type IconName } from "./icons.js";
import { SubscriptionBanner } from "./SubscriptionBanner.js";

type MenuEntry = { href: string; icon: IconName; title: string; hint: string };

/** Home's menu: where each part of the app is, in a word or two, with what it holds underneath. */
const MENU: readonly MenuEntry[] = [
  { href: "/invoices", icon: "invoices", title: "Invoices", hint: "Every month's invoices, and a CSV export" },
  { href: "/properties", icon: "properties", title: "Properties and units", hint: "Addresses, units and who rents each" },
  { href: "/tenants", icon: "tenants", title: "Tenants", hint: "Who you invoice, and their email" },
  { href: "/settings", icon: "settings", title: "Settings", hint: "Your details, logo, invoice look and plan" },
];

/** With one-off invoices on (G2a): writing one, the price list, and customers beside tenants. */
const ONE_OFF_MENU: readonly MenuEntry[] = [
  { href: "/one-off", icon: "oneOff", title: "One-off invoices", hint: "Write and send an invoice for a job or a sale" },
  { href: "/items", icon: "items", title: "Price list", hint: "Your services, materials and rates" },
  { href: "/payments", icon: "owed", title: "Payments", hint: "Record money received, and email receipts" },
  { href: "/credit-notes", icon: "creditNote", title: "Credit notes", hint: "Take money off an invoice already sent" },
];

/** With quotes on as well (G2q): before the invoices they turn into. */
const QUOTES: MenuEntry = { href: "/quotes", icon: "quote", title: "Quotes", hint: "Price the work first; the customer accepts online" };

export function menuFor(org: Setup["org"]): readonly MenuEntry[] {
  if (!hasFeature(org, "oneOff")) return MENU;
  const [invoices, properties, , settings] = MENU as [MenuEntry, MenuEntry, MenuEntry, MenuEntry];
  const customers: MenuEntry = { href: "/tenants", icon: "tenants", title: "Tenants and customers", hint: "Who you invoice, and their details" };
  const quotes = hasFeature(org, "quotes") ? [QUOTES] : [];
  return [...quotes, ...ONE_OFF_MENU, { ...invoices, title: "Rent invoices" }, properties, customers, settings];
}

/** Home (plan §7, screen 3): this month's one action (the card, as children), the amount owed, then setup. */
/** today: shows the subscription banner (PLAN-SUBSCRIBERS §8) when there is one. */
/** quotesToInvoice: accepted quotes nothing has been invoiced from, a week on (G2q-c, AR-1). */
export function Home(props: { setup: Setup; today?: CalendarDate; owedToea?: number; quotesToInvoice?: number; onSignOut: () => void; children?: ComponentChildren }) {
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
          {props.quotesToInvoice !== undefined && props.quotesToInvoice > 0 && (
            <a class="stat" href="/quotes">
              <span class="stat-value">{props.quotesToInvoice}</span>{" "}
              <span class="stat-label">accepted {props.quotesToInvoice === 1 ? "quote" : "quotes"} not invoiced</span>
            </a>
          )}
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
          {menuFor(org).map((m) => (
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
