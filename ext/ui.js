import { SOURCE_GROUPS, TARGETS, anySource, sourceLabel, ringStep } from "./config.js";

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (value !== false && value != null) el.setAttribute(key, value === true ? "" : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

/** Progress ring whose fill and colour follow quality; mirrors the icons the context menu uses. */
export function ring(quality, lossless = false) {
  const step = lossless ? 10 : ringStep(quality);
  const el = h("span", { class: "ring", "aria-hidden": "true" });
  el.style.setProperty("--fill", `${lossless ? 100 : quality}`);
  el.style.setProperty("--hue", `${step * 12}`);
  return el;
}

export const targetSummary = (id, quality) =>
  TARGETS[id].quality ? `${TARGETS[id].label} · ${quality[id]}%` : `${TARGETS[id].label} · lossless`;

export const sourceSummary = (from) => from.map(sourceLabel).join(", ");

const closeAll = () => document.querySelectorAll(".cascade[open]").forEach((d) => d.removeAttribute("open"));
// composedPath survives re-renders that detach the clicked item mid-event.
document.addEventListener("click", (e) => {
  if (!e.composedPath().some((n) => n.classList?.contains("cascade"))) closeAll();
});
document.addEventListener("keydown", (e) => e.key === "Escape" && closeAll());

function cascade({ groups, label, isChecked, onPick }) {
  const summary = h("summary", { class: "cascade-button" }, label());
  const details = h("details", { class: "cascade" }, summary);
  const groupList = h("ul", { class: "cascade-groups", role: "menu" });
  const flyout = h("ul", { class: "cascade-items", role: "menu" });

  const renderItems = (group) => {
    flyout.replaceChildren(
      ...group.items.map((item) =>
        h("li", {},
          h("button", {
            type: "button",
            role: "menuitemcheckbox",
            "aria-checked": `${isChecked(item.id)}`,
            class: item.all ? "all" : "",
            onclick: () => {
              onPick(item.id);
              summary.replaceChildren(label());
              markGroups();
              renderItems(group);
            },
          }, item.label),
        ),
      ),
    );
  };
  const open = (group, button) => {
    groupList.querySelectorAll("[aria-expanded]").forEach((b) => b.setAttribute("aria-expanded", "false"));
    button.setAttribute("aria-expanded", "true");
    renderItems(group);
  };
  const groupButtons = groups.map((group) => {
    const button = h("button", {
      type: "button",
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      onmouseenter: () => open(group, button),
      onfocus: () => open(group, button),
      onclick: () => open(group, button),
    }, h("span", {}, group.label), h("span", { class: "chev" }, "›"));
    groupList.append(h("li", {}, button));
    return button;
  });
  const markGroups = () =>
    groups.forEach((g, i) => groupButtons[i].classList.toggle("has-pick", g.items.some((item) => isChecked(item.id))));
  markGroups();
  details.addEventListener("toggle", () => {
    if (!details.open) return;
    document.querySelectorAll(".cascade[open]").forEach((d) => d !== details && d.removeAttribute("open"));
    const first = groups.findIndex((g) => g.items.some((i) => isChecked(i.id)));
    const index = Math.max(0, first);
    open(groups[index], groupList.children[index].firstChild);
  });
  details.append(h("div", { class: "cascade-panel" }, groupList, flyout));
  return details;
}

const SOURCE_TREE = SOURCE_GROUPS.map((g) => ({
  label: g.label,
  items: [{ id: anySource(g.kind), label: g.allLabel, all: true }, ...g.formats.map((f) => ({ id: `${g.kind}:${f.id}`, label: f.label }))],
}));

export function sourcePicker(rule, onChange) {
  return cascade({
    groups: SOURCE_TREE,
    label: () => sourceSummary(rule.from) || "Choose files",
    isChecked: (id) => rule.from.includes(id),
    onPick: (id) => {
      const [kind] = id.split(":");
      const sameKind = (s) => s.startsWith(`${kind}:`);
      if (rule.from.includes(id)) rule.from = rule.from.filter((s) => s !== id);
      else if (id === anySource(kind)) rule.from = [...rule.from.filter((s) => !sameKind(s)), id];
      else rule.from = [...rule.from.filter((s) => s !== anySource(kind)), id];
      onChange();
    },
  });
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
