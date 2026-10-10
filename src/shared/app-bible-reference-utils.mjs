/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
export function parseScriptureReference(input) {
  const tokens = String(input || "").trim().split(/\s+/).filter(Boolean);
  let book = "";
  let chapter;
  let verse;
  let verseEnd;
  let verseSelector = "";
  tokens.forEach((token, index) => {
    if (token.includes(":")) {
      const parts = token.split(":");
      chapter = Number.parseInt(parts[0], 10);
      verseSelector = String(parts.slice(1).join(":") || "");
      const firstVersePart = verseSelector.split(",")[0] || "";
      const verseParts = firstVersePart.split("-");
      verse = Number.parseInt(verseParts[0], 10);
      verseEnd = verseSelector.includes(",")
        ? undefined
        : Number.parseInt(verseParts[1], 10);
    } else if (!Number.isNaN(Number.parseInt(token, 10)) && index === tokens.length - 1) {
      chapter = Number.parseInt(token, 10);
    } else {
      book = book ? `${book} ${token}` : token;
    }
  });
  return { book, chapter, verse, verseEnd, verseSelector };
}

export function normalizeScriptureReference(input) {
  return String(input || "")
    .trim()
    .replace(/\s*:\s*/g, ":")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s+/g, " ");
}

export function bibleTextVerseRows(response) {
  const explicitRows = Array.isArray(response?.verseRows) ? response.verseRows : [];
  if (explicitRows.length > 0) {
    return explicitRows
      .map((row) => ({
        verseNumber: Math.trunc(Number(row?.verseNumber ?? row?.verse)),
        text: typeof row?.text === "string" ? row.text : "",
      }))
      .filter((row) => row.verseNumber > 0 && row.text);
  }

  return (Array.isArray(response?.verses) ? response.verses : [])
    .map((text, index) => ({
      verseNumber: index + 1,
      text: typeof text === "string" ? text : "",
    }))
    .filter((row) => row.text);
}
