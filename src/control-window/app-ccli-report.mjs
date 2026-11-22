import { hasCcliNumber } from "../shared/ccli-report.mjs";

function localDate(date) {
  const pad = value => String(value).padStart(2, "0");
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-");
}

export function installCcliReport(invoke) {
  const dialog = document.getElementById("ccliReport");
  const from = document.getElementById("ccliFrom");
  const to = document.getElementById("ccliTo");
  const body = document.getElementById("ccliRows");
  const status = document.getElementById("ccliStatus");
  const exportButton = document.getElementById("ccliExport");
  let rows = [];
  let generation = 0;
  let saving = Promise.resolve();

  function summary() {
    const included = rows.filter(row => row.included);
    const ready = included.filter(hasCcliNumber).length;
    const missing = included.length - ready;
    status.textContent = rows.length
      ? `${ready} of ${rows.length} projections included in CSV.` +
        (missing ? ` Enter a numeric CCLI song number for ${missing} more.` : "")
      : "No song projections recorded in this period.";
    exportButton.disabled = ready === 0;
  }

  function addRow(row) {
    const tr = body.insertRow();
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = row.included;
    check.setAttribute("aria-label", `Include ${row.title}`);
    tr.insertCell().append(check);
    tr.insertCell().textContent = row.projectedAt.slice(0, 19).replace("T", " ");
    const title = tr.insertCell();
    title.textContent = row.title;
    const authors = document.createElement("small");
    authors.textContent = row.authors;
    title.append(authors);
    const number = document.createElement("input");
    number.type = "text";
    number.inputMode = "numeric";
    number.value = row.ccliNumber;
    number.placeholder = "Needs number";
    number.setAttribute("aria-label", `CCLI song number for ${row.title}`);
    tr.insertCell().append(number);

    function save() {
      const current = generation;
      const review = { id: row.id, included: check.checked, ccliNumber: number.value.trim() };
      check.disabled = number.disabled = true;
      saving = saving.then(async () => {
        try {
          await invoke("song-projections:review", review);
          Object.assign(row, review);
          if (generation === current) summary();
          return true;
        } catch (error) {
          check.checked = row.included;
          number.value = row.ccliNumber;
          if (generation === current) status.textContent = `Review change could not be saved. ${error.message}`;
          return false;
        } finally {
          check.disabled = number.disabled = false;
        }
      });
    }
    check.addEventListener("change", save);
    number.addEventListener("change", save);
    number.addEventListener("keydown", event => {
      if (event.key === "Enter") number.blur();
    });
  }

  async function load() {
    const current = ++generation;
    rows = [];
    body.replaceChildren();
    exportButton.disabled = true;
    if (!from.value || !to.value || from.value > to.value) {
      status.textContent = "Choose a valid date range.";
      return;
    }
    status.textContent = "Loading song activity…";
    try {
      await saving;
      const activity = await invoke("song-projections:list", { from: from.value, to: to.value });
      if (generation !== current) return;
      saving = Promise.resolve();
      rows = activity;
      rows.forEach(addRow);
      summary();
    } catch (error) {
      if (generation === current) status.textContent = error.message;
    }
  }

  document.getElementById("menuCcliReport").addEventListener("click", () => {
    const now = new Date();
    from.value ||= localDate(new Date(now.getFullYear(), now.getMonth(), 1));
    to.value ||= localDate(now);
    dialog.showModal();
    void load();
  });
  dialog.addEventListener("keydown", event => event.stopPropagation());
  document.getElementById("ccliClose").addEventListener("click", () => dialog.close());
  from.addEventListener("change", load);
  to.addEventListener("change", load);
  exportButton.addEventListener("click", async () => {
    const current = generation;
    const reviewSaved = await saving;
    if (reviewSaved === false || generation !== current || exportButton.disabled) return;
    exportButton.disabled = true;
    try {
      const saved = await invoke("song-projections:export", { from: from.value, to: to.value, rows });
      if (saved) status.textContent = "Summary CSV saved for manual reporting.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      if (generation === current) exportButton.disabled = !rows.some(row => row.included && hasCcliNumber(row));
    }
  });
}
