#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.resolve(repoRoot, process.argv[2] || "public-bibles/cpdv.osis.xml");
const outputPath = path.resolve(
  repoRoot,
  process.argv[3] || "public-bibles/CATHOLIC PUBLIC DOMAIN VERSION.json",
);

const BOOKS = new Map(Object.entries({
  Gen: "Genesis", Exod: "Exodus", Lev: "Leviticus", Num: "Numbers", Deut: "Deuteronomy",
  Josh: "Joshua", Judg: "Judges", Ruth: "Ruth", "1Sam": "1 Samuel", "2Sam": "2 Samuel",
  "1Kgs": "1 Kings", "2Kgs": "2 Kings", "1Chr": "1 Chronicles", "2Chr": "2 Chronicles",
  Ezra: "Ezra", Neh: "Nehemiah", Tob: "Tobit", Jdt: "Judith", Esth: "Esther", Job: "Job",
  Ps: "Psalms", Prov: "Proverbs", Eccl: "Ecclesiastes", Song: "Song of Solomon",
  Wis: "Wisdom of Solomon", Sir: "Ecclesiasticus (Sira)", Isa: "Isaiah", Jer: "Jeremiah",
  Lam: "Lamentations", Bar: "Baruch", Ezek: "Ezekiel", Dan: "Daniel", Hos: "Hosea",
  Joel: "Joel", Amos: "Amos", Obad: "Obadiah", Jonah: "Jonah", Mic: "Micah", Nah: "Nahum",
  Hab: "Habakkuk", Zeph: "Zephaniah", Hag: "Haggai", Zech: "Zechariah", Mal: "Malachi",
  "1Macc": "1 Maccabees", "2Macc": "2 Maccabees", Matt: "Matthew", Mark: "Mark", Luke: "Luke",
  John: "John", Acts: "Acts", Rom: "Romans", "1Cor": "1 Corinthians", "2Cor": "2 Corinthians",
  Gal: "Galatians", Eph: "Ephesians", Phil: "Philippians", Col: "Colossians",
  "1Thess": "1 Thessalonians", "2Thess": "2 Thessalonians", "1Tim": "1 Timothy",
  "2Tim": "2 Timothy", Titus: "Titus", Phlm: "Philemon", Heb: "Hebrews", Jas: "James",
  "1Pet": "1 Peter", "2Pet": "2 Peter", "1John": "1 John", "2John": "2 John",
  "3John": "3 John", Jude: "Jude", Rev: "Revelation",
}));

// Some OSIS milestones combine multiple canonical verse numbers even though
// the published CPDV displays a distinct text boundary. The split marker is
// required to occur exactly once so source changes fail loudly.
const RANGE_SPLITS = new Map([
  ["Esth.4.12-13", { nextVerseStartsWith: "he again sent word to Esther" }],
]);

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || "";
}

function decodeXML(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    const lower = entity.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const radix = lower.startsWith("#x") ? 16 : 10;
    const digits = lower.slice(radix === 16 ? 2 : 1);
    return String.fromCodePoint(Number.parseInt(digits, radix));
  });
}

function cleanText(parts) {
  return decodeXML(parts.join(" ")).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

const xml = readFileSync(inputPath, "utf8");
const output = {};
let currentBookID = "";
let currentVerseID = "";
let currentVerseParts = [];
let excludedDepth = 0;
let verseCount = 0;
let emptyVerseCount = 0;
const seenBooks = [];
const excludedElements = new Set(["note", "title"]);

function storeVerse() {
  const match = currentVerseID.match(/^([^.]+)\.(\d+)\.(\d+)(?:-(\d+))?$/);
  if (!match) throw new Error(`Unsupported OSIS verse ID: ${currentVerseID}`);
  const [, bookID, chapter, firstVerse, finalVerseValue] = match;
  const bookName = BOOKS.get(bookID);
  if (!bookName || bookID !== currentBookID) throw new Error(`Unexpected book in ${currentVerseID}`);
  output[bookName] ||= {};
  output[bookName][chapter] ||= {};
  const text = cleanText(currentVerseParts);
  const finalVerse = Number(finalVerseValue || firstVerse);
  let verseTexts = [text, ...Array.from({ length: finalVerse - Number(firstVerse) }, () => "")];
  const split = RANGE_SPLITS.get(currentVerseID);
  if (split) {
    const markerIndex = text.indexOf(split.nextVerseStartsWith);
    if (markerIndex <= 0 || text.indexOf(split.nextVerseStartsWith, markerIndex + 1) !== -1) {
      throw new Error(`Unable to split combined OSIS verse ${currentVerseID}`);
    }
    verseTexts = [text.slice(0, markerIndex).trim(), text.slice(markerIndex).trim()];
    if (verseTexts.length !== finalVerse - Number(firstVerse) + 1 || verseTexts.some((value) => !value)) {
      throw new Error(`Invalid split result for combined OSIS verse ${currentVerseID}`);
    }
  }
  for (let verse = Number(firstVerse); verse <= finalVerse; verse += 1) {
    if (Object.hasOwn(output[bookName][chapter], verse)) throw new Error(`Duplicate verse ${bookID}.${chapter}.${verse}`);
    output[bookName][chapter][verse] = verseTexts[verse - Number(firstVerse)];
    verseCount += 1;
    if (!output[bookName][chapter][verse]) emptyVerseCount += 1;
  }
  currentVerseID = "";
  currentVerseParts = [];
}

for (const token of xml.match(/<[^>]+>|[^<]+/g) || []) {
  if (!token.startsWith("<")) {
    if (currentVerseID && excludedDepth === 0) currentVerseParts.push(token);
    continue;
  }
  if (token.startsWith("<!--") || token.startsWith("<?") || token.startsWith("<!")) continue;
  const closing = /^<\//.test(token);
  const element = token.match(/^<\/?\s*([\w:-]+)/)?.[1] || "";
  if (closing) {
    if (excludedElements.has(element) && excludedDepth > 0) excludedDepth -= 1;
    continue;
  }
  if (excludedElements.has(element)) {
    excludedDepth += 1;
    continue;
  }
  if (element === "div" && attribute(token, "type") === "book") {
    currentBookID = attribute(token, "osisID");
    const bookName = BOOKS.get(currentBookID);
    if (!bookName) throw new Error(`Unsupported OSIS book: ${currentBookID}`);
    if (seenBooks.includes(currentBookID)) throw new Error(`Duplicate OSIS book: ${currentBookID}`);
    seenBooks.push(currentBookID);
    continue;
  }
  if (element !== "verse") continue;
  const startID = attribute(token, "sID");
  const endID = attribute(token, "eID");
  if (startID) {
    if (currentVerseID) throw new Error(`Verse ${currentVerseID} was not closed before ${startID}`);
    currentVerseID = startID;
    currentVerseParts = [];
    excludedDepth = 0;
  } else if (endID) {
    if (endID !== currentVerseID) throw new Error(`Verse end ${endID} does not match ${currentVerseID}`);
    storeVerse();
  }
}

if (currentVerseID) throw new Error(`Unclosed verse: ${currentVerseID}`);
if (seenBooks.length !== BOOKS.size) {
  const missing = [...BOOKS.keys()].filter((book) => !seenBooks.includes(book));
  throw new Error(`Expected ${BOOKS.size} books, found ${seenBooks.length}; missing: ${missing.join(", ")}`);
}
if (Object.keys(output).length !== BOOKS.size) throw new Error("One or more OSIS books contained no verses");

writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  `Converted ${Object.keys(output).length} books and ${verseCount} verses ` +
    `(${emptyVerseCount} empty versification placeholders) from ${inputPath} to ${outputPath}`,
);
