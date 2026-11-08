import { localDate } from "@sasimem/core";
import { render } from "preact";
import { App } from "./app.js";
import { actions, session } from "./session.js";
import "./styles.css";

// "Today" is the landlord's calendar day in Port Moresby time, never the device's guess (plan §3.3).
const today = () => localDate(new Date(), "Pacific/Port_Moresby");

// Sign-up is closed while Sasimem is invite-only: .env.production sets VITE_SIGN_UP=closed for
// real builds; the emulator build leaves it open for the T4 journeys. Firebase Auth refuses
// new accounts on its own too, so this only stops the app offering what would fail.
const signUpOpen = import.meta.env["VITE_SIGN_UP"] !== "closed";

const root = document.getElementById("app");
if (root) render(<App session={session} actions={actions} today={today} signUpOpen={signUpOpen} />, root);
