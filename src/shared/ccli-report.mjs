export function hasCcliNumber(row) {
  return /^[0-9]+$/.test(String(row.ccliNumber || "").trim());
}

function csvCell(value) {
  // Quoting alone does not stop spreadsheets from evaluating imported titles.
  const text = String(value);
  const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function projectionReportCsv(rows, from, to) {
  const songs = new Map();
  for (const row of rows) {
    if (!row.included || !hasCcliNumber(row)) continue;
    const number = String(row.ccliNumber).trim();
    const song = songs.get(number) || { title: row.title, authors: row.authors, count: 0 };
    song.count += 1;
    songs.set(number, song);
  }
  if (!songs.size) throw new Error("Include a projection with a CCLI song number to export.");
  const data = [["Period start", "Period end", "CCLI song number", "Title", "Authors", "Projections"]];
  for (const [number, song] of [...songs].sort((a, b) => a[1].title.localeCompare(b[1].title) || a[0].localeCompare(b[0]))) {
    data.push([from, to, number, song.title, song.authors, song.count]);
  }
  return "\uFEFF" + data.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
