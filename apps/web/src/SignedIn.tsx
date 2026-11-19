/**
 * The signed-in app (step 3): home and the setup screens. Everything a landlord
 * has is loaded once (1-20 tenancies) and reloaded after each save, so every
 * screen shows what was actually stored.
 */
import { type ReadonlySignal, signal, useSignal } from "@preact/signals";
import { type CalendarDate, type Period, hasFeature, periodOf } from "@sasimem/core";
import { createContext } from "preact";
import { useContext, useEffect } from "preact/hooks";
import { LocationProvider, Route, Router, useLocation } from "preact-iso";
import type { Actions } from "./app.js";
import { lazyScreen } from "./lazy.js";
import { newPaymentId } from "./payment-id.js";
import { Mark } from "./screens/icons.js";
import type { CreditNoteRow, CreditableRow, Month, Numbering, Outcome, PaymentRow, ScheduledDraft, Setup, SetupStore } from "./setup.js";
import { invoiceTemplateName } from "./template-choice.js";

const Home = lazyScreen(() => import("./screens/Home.js").then((m) => m.Home));
const Properties = lazyScreen(() => import("./screens/Properties.js").then((m) => m.Properties));
const PropertyForm = lazyScreen(() => import("./screens/PropertyForm.js").then((m) => m.PropertyForm));
const Tenants = lazyScreen(() => import("./screens/Tenants.js").then((m) => m.Tenants));
const TenantForm = lazyScreen(() => import("./screens/TenantForm.js").then((m) => m.TenantForm));
const TenancyForm = lazyScreen(() => import("./screens/TenancyForm.js").then((m) => m.TenancyForm));
const Settings = lazyScreen(() => import("./screens/Settings.js").then((m) => m.Settings));
const PlanBilling = lazyScreen(() => import("./screens/PlanBilling.js").then((m) => m.PlanBilling));
const Templates = lazyScreen(() => import("./screens/Templates.js").then((m) => m.Templates));
const TemplateForm = lazyScreen(() => import("./screens/TemplateForm.js").then((m) => m.TemplateForm));
const LogoBuilder = lazyScreen(() => import("./logo/LogoBuilder.js").then((m) => m.LogoBuilder));
const MonthCard = lazyScreen(() => import("./screens/MonthCard.js").then((m) => m.MonthCard));
const Review = lazyScreen(() => import("./screens/Review.js").then((m) => m.Review));
const Tracking = lazyScreen(() => import("./screens/Tracking.js").then((m) => m.Tracking));
const Invoices = lazyScreen(() => import("./screens/Invoices.js").then((m) => m.Invoices));
const Owed = lazyScreen(() => import("./screens/Owed.js").then((m) => m.Owed));
const Items = lazyScreen(() => import("./screens/Items.js").then((m) => m.Items));
const ItemForm = lazyScreen(() => import("./screens/Items.js").then((m) => m.ItemForm));
const OneOffs = lazyScreen(() => import("./screens/OneOffs.js").then((m) => m.OneOffs));
const InvoiceEditor = lazyScreen(() => import("./screens/InvoiceEditor.js").then((m) => m.InvoiceEditor));
const Payments = lazyScreen(() => import("./screens/Payments.js").then((m) => m.Payments));
const PaymentForm = lazyScreen(() => import("./screens/PaymentForm.js").then((m) => m.PaymentForm));
const CreditNotes = lazyScreen(() => import("./screens/CreditNotes.js").then((m) => m.CreditNotes));
const CreditNoteForm = lazyScreen(() => import("./screens/CreditNoteForm.js").then((m) => m.CreditNoteForm));

const OFFLINE = "Your details could not be loaded. Check your signal, then reload the page.";

/**
 * What every signed-in route reads. `setup` is a signal, read inside each route, so a
 * reload re-renders the screen showing now. (Closures over a plain value went stale:
 * preact-iso does not re-render the current route when only its parent changes.)
 */
interface Context {
  readonly store: SetupStore;
  readonly setup: ReadonlySignal<Setup>;
  readonly today: CalendarDate;
  readonly reload: () => Promise<void>;
  readonly signOut: () => Promise<void>;
}
const Ctx = createContext<Context | null>(null);

function useSignedIn(): Context {
  const c = useContext(Ctx);
  if (c === null) throw new Error("signed-in route outside SignedIn");
  return c;
}

export function SignedIn(props: { orgId: string; actions: Actions; today: CalendarDate }) {
  const context = useSignal<Context | null>(null);
  const failed = useSignal(false);

  useEffect(() => {
    void props.actions.setupStore(props.orgId).then(async (store) => {
      try {
        const setup = signal(await store.load());
        const reload = async () => {
          try {
            setup.value = await store.load();
          } catch {
            failed.value = true;
          }
        };
        context.value = { store, setup, today: props.today, reload, signOut: props.actions.signOut };
      } catch {
        failed.value = true;
      }
    });
  }, [props.orgId]);

  if (failed.value) return <main class="narrow"><p role="alert">{OFFLINE}</p></main>;
  if (context.value === null) return <main class="narrow"><p>Loading…</p></main>;
  return (
    <Ctx.Provider value={context.value}>
      <LocationProvider>
        <TopBar />
        <Router>
          <Route path="/properties" component={PropertiesRoute} />
          <Route path="/properties/:id" component={PropertyRoute} />
          <Route path="/tenants" component={TenantsRoute} />
          <Route path="/tenants/:id" component={TenantRoute} />
          <Route path="/tenancies/:id" component={TenancyRoute} />
          <Route path="/settings" component={SettingsRoute} />
          <Route path="/settings/logo" component={LogoRoute} />
          <Route path="/settings/billing" component={PlanBillingRoute} />
          <Route path="/settings/templates" component={TemplatesRoute} />
          <Route path="/settings/templates/:id" component={TemplateRoute} />
          <Route path="/month/:period" component={ReviewRoute} />
          <Route path="/invoices" component={InvoicesRoute} />
          <Route path="/owed" component={OwedRoute} />
          <Route path="/items" component={ItemsRoute} />
          <Route path="/items/:id" component={ItemRoute} />
          <Route path="/one-off" component={OneOffsRoute} />
          <Route path="/one-off/:id" component={EditorRoute} />
          <Route path="/payments" component={PaymentsRoute} />
          <Route path="/payments/new" component={PaymentFormRoute} />
          <Route path="/credit-notes" component={CreditNotesRoute} />
          <Route path="/credit-notes/new" component={CreditNoteFormRoute} />
          <Route default component={HomeRoute} />
        </Router>
      </LocationProvider>
    </Ctx.Provider>
  );
}

/** The bar across the top of every signed-in screen: the way home, and whose rentals these are. */
function TopBar() {
  const { setup } = useSignedIn();
  return (
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="/"><Mark />Sasimem</a>
        <span class="topbar-org">{setup.value.org.name}</span>
      </div>
    </header>
  );
}

type Params = { params: Record<string, string> };
const idOf = ({ params }: Params) => (params["id"] === "new" ? null : (params["id"] ?? null));

/** After a save elsewhere: reload what was stored, then go back up a level. */
function useDoneTo(path: string): () => void {
  const { reload } = useSignedIn();
  const { route } = useLocation();
  return () => void reload().then(() => route(path));
}

/** A month's run, loaded when shown and again after each change. */
function useMonth(period: Period) {
  const { store } = useSignedIn();
  const month = useSignal<Month | null | string | undefined>(undefined);
  const reload = async () => {
    month.value = await store.month(period);
  };
  useEffect(() => void reload(), [store, period]);
  /** Run a callable, then reload the month so the screen shows what was stored. */
  const thenReload = <A extends unknown[]>(act: (...a: A) => Promise<Outcome>) => async (...a: A) => {
    const outcome = await act(...a);
    await reload();
    return outcome;
  };
  return { month, thenReload };
}

function HomeRoute() {
  const c = useSignedIn();
  const period = periodOf(c.today);
  const { month, thenReload } = useMonth(period);
  const owed = useOwedTotal();
  const m = month.value;
  return (
    <Home setup={c.setup.value} today={c.today} {...(owed.value === null ? {} : { owedToea: owed.value })} onSignOut={() => void c.signOut()}>
      {m === undefined ? <p class="note">Loading this month…</p>
        : typeof m === "string" ? <p role="alert">{m}</p>
        : <MonthCard period={period} month={m} timezone={c.setup.value.org.timezone} onDraftNow={thenReload(c.store.draftNow)} />}
    </Home>
  );
}

function ReviewRoute(props: { params: Record<string, string> }) {
  const c = useSignedIn();
  const period = props.params["period"] as Period;
  const { month, thenReload } = useMonth(period);
  const m = month.value;
  if (m === undefined) return <main class="narrow"><p>Loading…</p></main>;
  if (typeof m === "string") return <main class="narrow"><p role="alert">{m}</p></main>;
  if (m === null) return <main class="narrow"><p>{period} has no invoices yet. <a href="/">Back home</a></p></main>;
  if (m.status === "sent") {
    return (
      <Tracking month={m} today={c.today}
        onMarkPaid={thenReload(c.store.markPaid)} onMarkUnpaid={thenReload(c.store.markUnpaid)} onPauseReminders={thenReload(c.store.pauseReminders)}
        onVoid={thenReload(c.store.voidInvoice)} onResend={thenReload(c.store.resendInvoice)} onOpenPdf={c.store.openPdf}
        creditNotes={hasFeature(c.setup.value.org, "oneOff")} />
    );
  }
  return (
    <Review month={m} timezone={c.setup.value.org.timezone} templateName={(inv) => invoiceTemplateName(c.setup.value, inv)}
      onSetRent={thenReload(c.store.setRent)} onExclude={thenReload(c.store.exclude)} onInclude={thenReload(c.store.include)}
      onRebuild={thenReload(c.store.rebuildRun)} onApprove={thenReload(c.store.approveRun)} />
  );
}

/** What is owed across all months, for home; null until loaded or if it could not be. */
function useOwedTotal() {
  const { store } = useSignedIn();
  const total = useSignal<number | null>(null);
  useEffect(() => {
    void store.owed().then((g) => (total.value = typeof g === "string" ? null : g.reduce((t, x) => t + x.totalToea, 0)));
  }, [store]);
  return total;
}

function InvoicesRoute() {
  const c = useSignedIn();
  const months = useSignal<Awaited<ReturnType<SetupStore["months"]>> | null>(null);
  useEffect(() => void c.store.months().then((m) => (months.value = m)), [c.store]);
  const m = months.value;
  if (m === null) return <main class="narrow"><p>Loading…</p></main>;
  if (typeof m === "string") return <main class="narrow"><p role="alert">{m}</p></main>;
  return <Invoices months={m} thisMonth={periodOf(c.today)} onExport={c.store.exportCsv} />;
}

/** Unused credit per customer, for orgs that record payments (G2b, G2c); empty for the rest, which read nothing more. */
function useCredit(enabled: boolean) {
  const { store } = useSignedIn();
  const credit = useSignal<ReadonlyMap<string, number>>(new Map());
  const load = async () => {
    if (!enabled) return;
    const c = await store.credits();
    if (typeof c !== "string") credit.value = c;
  };
  useEffect(() => void load(), [store, enabled]);
  return credit;
}

function OwedRoute() {
  const c = useSignedIn();
  const payments = hasFeature(c.setup.value.org, "oneOff");
  const credit = useCredit(payments);
  const groups = useSignal<Awaited<ReturnType<SetupStore["owed"]>> | null>(null);
  const load = async () => void (groups.value = await c.store.owed());
  useEffect(() => void load(), [c.store]);
  const g = groups.value;
  if (g === null) return <main class="narrow"><p>Loading…</p></main>;
  if (typeof g === "string") return <main class="narrow"><p role="alert">{g}</p></main>;
  return (
    <Owed groups={g} today={c.today} payments={payments} credit={credit.value}
      onMarkPaid={async (id, note) => { const o = await c.store.markPaid(id, note); await load(); return o; }} />
  );
}

function PaymentsRoute() {
  const c = useSignedIn();
  const list = useSignal<readonly PaymentRow[] | string | null>(null);
  const load = async () => void (list.value = await c.store.payments());
  useEffect(() => void load(), [c.store]);
  const thenReload = <A extends unknown[]>(act: (...a: A) => Promise<Outcome>) => async (...a: A) => {
    const o = await act(...a);
    await load();
    return o;
  };
  const l = list.value;
  return (
    <OneOffOnly>
      {l === null ? <main class="narrow"><p>Loading…</p></main>
        : typeof l === "string" ? <main class="narrow"><p role="alert">{l}</p></main>
        : <Payments payments={l} onUndo={thenReload(c.store.undoPayment)} onResend={c.store.resendReceipt} />}
    </OneOffOnly>
  );
}

/** The form needs what is owed now; its payment ID is made once, so a retry records the payment once. */
function PaymentFormRoute() {
  const c = useSignedIn();
  const { query } = useLocation();
  const credit = useCredit(true);
  const owed = useSignal<Awaited<ReturnType<SetupStore["owed"]>> | null>(null);
  const paymentId = useSignal(newPaymentId());
  useEffect(() => void c.store.owed().then((o) => (owed.value = o)), [c.store]);
  const o = owed.value;
  return (
    <OneOffOnly>
      {o === null ? <main class="narrow"><p>Loading…</p></main>
        : typeof o === "string" ? <main class="narrow"><p role="alert">{o}</p></main>
        : <PaymentForm setup={c.setup.value} owed={o.flatMap((g) => g.invoices)} today={c.today} credit={credit.value} paymentId={paymentId.value}
            {...(query["customer"] === undefined ? {} : { customerId: query["customer"] })} onRecord={c.store.recordPayment} />}
    </OneOffOnly>
  );
}

function CreditNotesRoute() {
  const c = useSignedIn();
  const list = useSignal<readonly CreditNoteRow[] | string | null>(null);
  useEffect(() => void c.store.creditNotes().then((l) => (list.value = l)), [c.store]);
  const l = list.value;
  return (
    <OneOffOnly>
      {l === null ? <main class="narrow"><p>Loading…</p></main>
        : typeof l === "string" ? <main class="narrow"><p role="alert">{l}</p></main>
        : <CreditNotes creditNotes={l} onOpenPdf={c.store.openCreditNotePdf} onResend={c.store.resendCreditNote} />}
    </OneOffOnly>
  );
}

/** The invoice to credit, read fresh; the credit note's ID is made once, so a retry issues it once. */
function CreditNoteFormRoute() {
  const c = useSignedIn();
  const { query } = useLocation();
  const invoiceId = query["invoice"] ?? "";
  const invoice = useSignal<CreditableRow | null | string | undefined>(undefined);
  const creditNoteId = useSignal(newPaymentId());
  useEffect(() => void c.store.creditable(invoiceId).then((i) => (invoice.value = i ?? "That invoice is not there any more.")), [c.store, invoiceId]);
  const i = invoice.value;
  return (
    <OneOffOnly>
      {i === undefined ? <main class="narrow"><p>Loading…</p></main>
        : typeof i === "string" || i === null ? <main class="narrow"><p role="alert">{i}</p><p><a href="/credit-notes">Credit notes</a></p></main>
        : <CreditNoteForm invoice={i} creditNoteId={creditNoteId.value} onIssue={c.store.issueCreditNote} />}
    </OneOffOnly>
  );
}

function PropertiesRoute() {
  const c = useSignedIn();
  return <Properties setup={c.setup.value} today={c.today} />;
}

function PropertyRoute(props: Params) {
  const c = useSignedIn();
  const done = useDoneTo("/properties");
  return <PropertyForm key={props.params["id"]} id={idOf(props)} setup={c.setup.value} onSave={c.store.saveProperty} onDelete={c.store.deleteProperty} onDone={done} />;
}

function TenantsRoute() {
  return <Tenants setup={useSignedIn().setup.value} />;
}

function TenantRoute(props: Params) {
  const c = useSignedIn();
  const done = useDoneTo("/tenants");
  return <TenantForm key={props.params["id"]} id={idOf(props)} setup={c.setup.value} onSave={c.store.saveTenant} onDelete={c.store.deleteTenant} onDone={done} />;
}

function TenancyRoute(props: Params) {
  const c = useSignedIn();
  const done = useDoneTo("/properties");
  return (
    <TenancyForm key={props.params["id"]} id={idOf(props)} setup={c.setup.value} today={c.today}
      onCreate={c.store.createTenancy} onUpdate={c.store.updateTenancy} onDelete={c.store.deleteTenancy} onDone={done} />
  );
}

/** The templates list saves in place: making one the default reloads and stays. */
function TemplatesRoute() {
  const { store, setup, reload } = useSignedIn();
  return (
    <Templates setup={setup.value} onSetDefault={async (id) => {
      const problem = await store.setDefaultTemplate(id);
      if (problem === null) await reload();
      return problem;
    }} />
  );
}

function TemplateRoute(props: Params) {
  const c = useSignedIn();
  const done = useDoneTo("/settings/templates");
  return (
    <TemplateForm key={props.params["id"]} id={idOf(props)} setup={c.setup.value}
      onSave={c.store.saveTemplate} onDelete={c.store.deleteTemplate} onPreview={c.store.previewTemplate} onDone={done} />
  );
}

function PlanBillingRoute() {
  const c = useSignedIn();
  // After a cancel, reload: the status, banner and dates all change.
  const cancel = async () => {
    const o = await c.store.cancelSubscription();
    if (o.ok) await c.reload();
    return o;
  };
  return <PlanBilling setup={c.setup.value} today={c.today} loadPayments={c.store.subscriptionPayments} onAsk={c.store.askToChangePlan} onExport={c.store.exportEverything} onCancel={cancel} />;
}

function LogoRoute() {
  const c = useSignedIn();
  const done = useDoneTo("/settings");
  return <LogoBuilder org={c.setup.value.org} onSave={c.store.saveLogoDesign} onDone={done} />;
}

/** Settings saves in place, and also needs the numbering (a callable) and the logo's URL (Storage). */
function SettingsRoute() {
  const { store, setup, reload } = useSignedIn();
  const numbering = useSignal<Numbering | null>(null);
  const logoUrl = useSignal<string | null>(null);
  const logoPath = setup.value.org.logoPath;

  useEffect(() => {
    void store.numbering().then((n) => (numbering.value = typeof n === "string" ? null : n));
  }, [store]);
  useEffect(() => {
    if (logoPath === undefined) logoUrl.value = null;
    else void store.logoUrl(logoPath).then((u) => (logoUrl.value = u));
  }, [logoPath]);

  const thenReload = <A extends unknown[]>(act: (...a: A) => Promise<string | null>) => async (...a: A) => {
    const problem = await act(...a);
    if (problem === null) await reload();
    return problem;
  };

  return (
    <Settings
      org={setup.value.org} numbering={numbering.value} logoUrl={logoUrl.value}
      onSave={thenReload(store.saveProfile)} onUploadLogo={thenReload(store.uploadLogo)} onRemoveLogo={thenReload(store.removeLogo)}
      onSetNext={async (n) => {
        const problem = await store.setNextNumber(n);
        if (problem === null) numbering.value = { next: n, started: false };
        return problem;
      }}
    />
  );
}

/** One-off invoices (G2a) are only for orgs that have them; anyone else who types the address goes home. */
function OneOffOnly(props: { children: preact.ComponentChildren }) {
  const { setup } = useSignedIn();
  if (!hasFeature(setup.value.org, "oneOff")) return <main class="narrow"><p>One-off invoices are not switched on for your account. <a href="/">Back home</a></p></main>;
  return <>{props.children}</>;
}

function ItemsRoute() {
  return <OneOffOnly><Items setup={useSignedIn().setup.value} /></OneOffOnly>;
}

function ItemRoute(props: Params) {
  const c = useSignedIn();
  const done = useDoneTo("/items");
  return (
    <OneOffOnly>
      <ItemForm key={props.params["id"]} id={idOf(props)} setup={c.setup.value} onSave={c.store.saveItem} onDelete={c.store.deleteItem} onDone={done} />
    </OneOffOnly>
  );
}

function OneOffsRoute() {
  const c = useSignedIn();
  const list = useSignal<Awaited<ReturnType<SetupStore["oneOffs"]>> | null>(null);
  useEffect(() => void c.store.oneOffs().then((l) => (list.value = l)), [c.store]);
  const l = list.value;
  return (
    <OneOffOnly>
      {l === null ? <main class="narrow"><p>Loading…</p></main>
        : typeof l === "string" ? <main class="narrow"><p role="alert">{l}</p></main>
        : <OneOffs list={l} setup={c.setup.value} today={c.today} onOpenPdf={c.store.openPdf} />}
    </OneOffOnly>
  );
}

/** A new invoice, or a saved draft loaded first. A draft that was sent or deleted meanwhile says so. */
function EditorRoute(props: Params) {
  const c = useSignedIn();
  const { route } = useLocation();
  const id = idOf(props);
  const draft = useSignal<ScheduledDraft | null | string | undefined>(id === null ? null : undefined);
  useEffect(() => {
    if (id !== null) void c.store.draft(id).then((d) => (draft.value = d ?? "That draft is not there any more. It may have been sent or deleted."));
  }, [id]);
  const d = draft.value;
  return (
    <OneOffOnly>
      {d === undefined ? <main class="narrow"><p>Loading…</p></main>
        : typeof d === "string" ? <main class="narrow"><p role="alert">{d}</p><p><a href="/one-off">One-off invoices</a></p></main>
        : <InvoiceEditor key={props.params["id"]} id={id} draft={d} setup={c.setup.value} today={c.today}
            onSave={c.store.saveDraft} onDelete={c.store.deleteDraft} onSend={c.store.issueInvoice}
            onSchedule={c.store.scheduleInvoice} onCancelSchedule={c.store.cancelSchedule} onDone={() => route("/one-off")} />}
    </OneOffOnly>
  );
}
