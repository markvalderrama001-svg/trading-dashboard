import "./style.css";

import { bookPanel } from "./panels/book";
import { wheelPanel } from "./panels/wheel";
import { regimePanel } from "./panels/regime";
import { fearGreedPanel } from "./panels/feargreed";
import { newsPanel } from "./panels/news";
import { cashPanel } from "./panels/cash";
import { DEMO } from "./lib/demo";

// Grid order. CSS assigns each its column span by id.
const panels = [bookPanel, cashPanel, wheelPanel, newsPanel, regimePanel, fearGreedPanel];

if (DEMO) {
  const badge = document.createElement("span");
  badge.className = "brand-ro";
  badge.textContent = "DEMO DATA";
  badge.title = "Synthetic positions and prices. No account is connected.";
  document.querySelector(".brand")!.appendChild(badge);
}

const grid = document.getElementById("grid")!;
for (const p of panels) grid.appendChild(p.element);

// Cache-first paint, then live fetches on each panel's own cadence.
for (const p of panels) p.start();

document.getElementById("refresh-all")!.addEventListener("click", () => {
  for (const p of panels) void p.refresh(true);
});

const clock = document.getElementById("clock")!;
const tick = () => {
  clock.textContent = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
};
tick();
setInterval(tick, 1000);
