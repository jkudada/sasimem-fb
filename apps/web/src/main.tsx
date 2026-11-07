import { localDate } from "@sasimem/core";
import { render } from "preact";
import { App } from "./app.js";
import { actions, session } from "./session.js";
import "./styles.css";

// "Today" is the landlord's calendar day in Port Moresby time, never the device's guess (plan §3.3).
const today = () => localDate(new Date(), "Pacific/Port_Moresby");

const root = document.getElementById("app");
if (root) render(<App session={session} actions={actions} today={today} />, root);
