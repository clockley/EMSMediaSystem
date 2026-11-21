import { bibleTextVerseRows } from "./app-bible-reference-utils.mjs";

/** Resolve one adjacent verse without changing UI, schedule, or live output. */
export async function adjacentBibleVerseEntry(entry, direction, api, isCurrent = () => true) {
  if (direction !== -1 && direction !== 1) throw new RangeError("Invalid verse direction");
  if (!isCurrent()) return null;
  const metadata = await api.getBookMetadata(entry.version);
  if (!isCurrent()) return null;
  if (metadata?.error || !Array.isArray(metadata?.books) ||
      (metadata.version && metadata.version !== entry.version)) {
    throw new Error(metadata?.error || "Could not load Bible books");
  }
  const books = metadata.books.filter((book) => book?.name);
  const chapterCount = (book) => Number(book.chapters) || book.verseCounts?.length || 0;
  let bookIndex = books.findIndex((book) => book.name === entry.book);
  let chapter = Number(entry.chapter);
  if (bookIndex < 0 || !Number.isInteger(chapter) || chapter < 1 ||
      chapter > chapterCount(books[bookIndex])) {
    throw new Error("Choose a valid Bible reference");
  }

  const selected = (Array.isArray(entry.selectedVerses) ? entry.selectedVerses : [])
    .map(Number).filter((verse) => Number.isInteger(verse) && verse > 0);
  const endpoints = selected.length ? selected : [Number(entry.verse), Number(entry.verseEnd)]
    .filter((verse) => Number.isInteger(verse) && verse > 0);
  let edge = direction > 0
    ? (endpoints.length ? Math.max(...endpoints) : 0)
    : (endpoints.length ? Math.min(...endpoints) : 1);

  while (bookIndex >= 0 && bookIndex < books.length) {
    const book = books[bookIndex];
    if (!isCurrent()) return null;
    const response = await api.getText(entry.version, book.name, String(chapter));
    if (!isCurrent()) return null;
    if (!response || response.error) throw new Error(response?.error || "Could not load Bible chapter");
    const rows = bibleTextVerseRows(response)
      .filter((row) => row.text.trim())
      .sort((a, b) => a.verseNumber - b.verseNumber);
    const row = direction > 0
      ? rows.find((candidate) => candidate.verseNumber > edge)
      : rows.findLast((candidate) => candidate.verseNumber < edge);
    if (row) {
      return {
        ...entry,
        attribution: response.attribution || metadata.attribution || entry.attribution,
        book: book.name,
        bookAbbreviation: book.abbreviation || "",
        chapter,
        verse: row.verseNumber,
        verseEnd: 0,
        reference: `${book.name} ${chapter}:${row.verseNumber}`,
        text: row.text,
        selectedVerses: [row.verseNumber],
        verseRows: [{ ...row }],
        verseSelector: String(row.verseNumber),
        currentSlideId: null,
        lowerThirdSegmentIndex: 0,
        currentLowerThirdSlideId: null,
      };
    }
    chapter += direction;
    while (bookIndex >= 0 && bookIndex < books.length &&
           (chapter < 1 || chapter > chapterCount(books[bookIndex]))) {
      bookIndex += direction;
      if (bookIndex < 0 || bookIndex >= books.length) return null;
      chapter = direction > 0 ? 1 : chapterCount(books[bookIndex]);
    }
    edge = direction > 0 ? 0 : Infinity;
  }
  return null;
}