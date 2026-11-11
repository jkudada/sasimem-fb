import { render } from "preact";
import { App } from "./app.js";
import { actions, session } from "./auth.js";
import "./styles.css";

const root = document.getElementById("app");
if (root) render(<App session={session} actions={actions} now={() => new Date()} />, root);
