import { type CalendarDate, subscriptionNotice } from "@sasimem/core";
import type { Setup } from "../setup.js";

/**
 * The subscription banner (PLAN-SUBSCRIBERS §8): the trial's last two weeks, past due,
 * restricted, cancelled. Nothing otherwise, and nothing when the subscription could not be read.
 */
export function SubscriptionBanner(props: { setup: Setup; today: CalendarDate }) {
  const sub = props.setup.subscription;
  if (sub === undefined || sub === null) return null;
  const notice = subscriptionNotice(sub, props.today, props.setup.bank ?? null);
  if (notice === null) return null;
  return (
    <section class={`banner ${notice.tone}`} aria-label="Your Sasimem subscription">
      <h2>{notice.title}</h2>
      <p>{notice.body}</p>
      <p><a href="/settings/billing">Plan & billing</a></p>
    </section>
  );
}
