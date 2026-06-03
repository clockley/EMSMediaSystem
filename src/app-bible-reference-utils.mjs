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
const EMS_BIBLE_ALIAS_OVERRIDES = {
  jn: "John",
  jhn: "John",
  mt: "Matthew",
  psa: "Psalms",
  psalm: "Psalms",
};

export function normalizeBibleAlias(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addBibleAliasCandidate(candidates, alias, bookName) {
  const normalized = normalizeBibleAlias(alias);
  if (!normalized) return;
  if (!candidates.has(normalized)) candidates.set(normalized, new Set());
  candidates.get(normalized).add(bookName);
}

export function buildBibleAliasMap(
  bibleBooksCache,
  aliasOverrides = EMS_BIBLE_ALIAS_OVERRIDES,
) {
  const candidates = new Map();
  bibleBooksCache.forEach((book) => {
    const bookName = book?.name || "";
    const normalizedName = normalizeBibleAlias(bookName);
    if (!normalizedName) return;

    addBibleAliasCandidate(candidates, normalizedName, bookName);
    addBibleAliasCandidate(candidates, normalizedName.replace(/\s+/g, ""), bookName);

    const tokens = normalizedName.split(" ");
    const numberPrefix = /^\d+$/.test(tokens[0]) ? tokens[0] : "";
    const bookTokens = numberPrefix ? tokens.slice(1) : tokens;
    const mainWord = bookTokens.find((token) => token !== "of" && token !== "the") || bookTokens[0];
    const acronym = bookTokens.map((token) => token[0]).join("");

    if (mainWord) {
      const maxPrefixLength = Math.min(4, mainWord.length);
      for (let length = 2; length <= maxPrefixLength; length += 1) {
        const prefix = mainWord.slice(0, length);
        if (numberPrefix) {
          addBibleAliasCandidate(candidates, `${numberPrefix} ${prefix}`, bookName);
          addBibleAliasCandidate(candidates, `${numberPrefix}${prefix}`, bookName);
        } else {
          addBibleAliasCandidate(candidates, prefix, bookName);
        }
      }
    }

    if (acronym.length > 1) {
      const alias = numberPrefix ? `${numberPrefix} ${acronym}` : acronym;
      addBibleAliasCandidate(candidates, alias, bookName);
      addBibleAliasCandidate(candidates, alias.replace(/\s+/g, ""), bookName);
    }
  });

  const aliasMap = new Map();
  candidates.forEach((matches, alias) => {
    if (matches.size === 1) aliasMap.set(alias, [...matches][0]);
  });
  Object.entries(aliasOverrides).forEach(([alias, bookName]) => {
    aliasMap.set(normalizeBibleAlias(alias), bookName);
    bibleBooksCache.forEach((book) => {
      const match = normalizeBibleAlias(book?.name || "").match(/^(\d+)\s+(.+)$/);
      if (match && normalizeBibleAlias(match[2]) === normalizeBibleAlias(bookName)) {
        aliasMap.set(normalizeBibleAlias(`${match[1]} ${alias}`), book.name);
        aliasMap.set(normalizeBibleAlias(`${match[1]}${alias}`), book.name);
      }
    });
  });
  return aliasMap;
}

export function matchBibleReferenceAlias(
  cleanInput,
  bibleBooksCache,
  aliasOverrides = EMS_BIBLE_ALIAS_OVERRIDES,
) {
  const aliasMap = buildBibleAliasMap(bibleBooksCache, aliasOverrides);
  const aliases = [...aliasMap.keys()].sort((a, b) => {
    const tokenDifference = b.split(" ").length - a.split(" ").length;
    return tokenDifference || b.length - a.length;
  });
  for (const alias of aliases) {
    if (cleanInput === alias) return { book: aliasMap.get(alias), numericTokens: [] };
    if (cleanInput.startsWith(`${alias} `)) {
      return {
        book: aliasMap.get(alias),
        numericTokens: cleanInput.slice(alias.length).trim().split(" ").filter(Boolean),
      };
    }
  }
  return null;
}

export function resolveBibleBookName(rawBook, bibleBooksCache) {
  const normalized = String(rawBook || "").trim().toLowerCase();
  if (!normalized) return null;
  const exact = bibleBooksCache.find((book) => book.name.toLowerCase() === normalized);
  if (exact) return exact.name;
  const prefixMatches = bibleBooksCache.filter((book) =>
    book.name.toLowerCase().startsWith(normalized),
  );
  if (prefixMatches.length === 1) return prefixMatches[0].name;
  return null;
}

export function parseScriptureReference(input) {
  const tokens = String(input || "").trim().split(/\s+/).filter(Boolean);
  let book = "";
  let chapter;
  let verse;
  let verseEnd;
  tokens.forEach((token, index) => {
    if (token.includes(":")) {
      const parts = token.split(":");
      chapter = Number.parseInt(parts[0], 10);
      const verseParts = String(parts[1] || "").split("-");
      verse = Number.parseInt(verseParts[0], 10);
      verseEnd = Number.parseInt(verseParts[1], 10);
    } else if (!Number.isNaN(Number.parseInt(token, 10)) && index === tokens.length - 1) {
      chapter = Number.parseInt(token, 10);
    } else {
      book = book ? `${book} ${token}` : token;
    }
  });
  return { book, chapter, verse, verseEnd };
}

export function normalizeScriptureReference(input) {
  return String(input || "")
    .trim()
    .replace(/\s*:\s*/g, ":")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ");
}

export function normalizeBibleReferenceInput(
  rawReference,
  bibleBooksCache,
  aliasOverrides = EMS_BIBLE_ALIAS_OVERRIDES,
) {
  const cleanInput = String(rawReference || "")
    .toLowerCase()
    .replace(/[:\-.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleanInput) return null;

  const aliasMatch = matchBibleReferenceAlias(cleanInput, bibleBooksCache, aliasOverrides);
  let resolvedBook = aliasMatch?.book || "";
  let numericTokens = aliasMatch?.numericTokens || [];

  if (!resolvedBook) {
    const parsed = parseScriptureReference(normalizeScriptureReference(rawReference));
    resolvedBook = resolveBibleBookName(parsed.book, bibleBooksCache);
    if (!resolvedBook) return null;
    numericTokens = [
      parsed.chapter,
      parsed.verse,
      parsed.verseEnd,
    ].filter((number) => Number.isFinite(number) && number > 0);
  }

  if (!numericTokens.length) {
    numericTokens = [1, 1];
  }

  if (!numericTokens.every((token) => /^\d+$/.test(String(token)))) {
    return null;
  }

  const [chapter, startVerse, rawEndVerse] = numericTokens.map((token) =>
    Number.parseInt(token, 10),
  );
  if (!Number.isFinite(chapter) || chapter < 1) return null;
  let verse = Number.isFinite(startVerse) && startVerse > 0 ? startVerse : 0;
  let verseEnd = Number.isFinite(rawEndVerse) && rawEndVerse > 0 ? rawEndVerse : 0;
  if (verse > 0 && verseEnd > 0 && verseEnd < verse) {
    [verse, verseEnd] = [verseEnd, verse];
  }
  if (verseEnd === verse) verseEnd = 0;

  return {
    book: resolvedBook,
    chapter,
    verse,
    verseEnd,
    reference:
      verse > 0
        ? `${resolvedBook} ${chapter}:${verse}${verseEnd > verse ? `-${verseEnd}` : ""}`
        : `${resolvedBook} ${chapter}`,
  };
}
