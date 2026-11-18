/**
 * The frame around signing in and first setup: what Sasimem does on one side, the
 * form on the other. On a phone the pitch folds away and only the name stays on top.
 */
import type { ComponentChildren } from "preact";
import { Mark } from "./screens/icons.js";

export function Welcome(props: { children: ComponentChildren }) {
  return (
    <div class="welcome">
      <aside class="welcome-brand">
        <div class="brand"><Mark />Sasimem</div>
        <div class="welcome-pitch">
          <p class="welcome-headline">Rent invoices, done for you every month.</p>
          <ul>
            <li>Drafted before the rent is due</li>
            <li>Sent only once you approve them</li>
            <li>See who has paid at a glance</li>
          </ul>
        </div>
      </aside>
      <div class="welcome-panel">{props.children}</div>
    </div>
  );
}
