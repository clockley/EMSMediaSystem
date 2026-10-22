/*
Copyright (C) 2026 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/**
 * Creates a monotonic ownership gate for asynchronous UI work.
 *
 * Starting or invalidating a request permanently supersedes every older
 * token.  An optional owner can be captured with the token so callers that
 * edit mutable workspace state can require both "latest request" and stable
 * object identity before committing a result.
 */
export function createLatestRequestGate() {
  let revision = 0;

  return Object.freeze({
    begin(owner = undefined) {
      revision += 1;
      return Object.freeze({ revision, owner });
    },

    invalidate() {
      revision += 1;
      return revision;
    },

    isCurrent(request) {
      return Boolean(request) && request.revision === revision;
    },

    owns(request, owner) {
      return Boolean(request) && request.revision === revision && request.owner === owner;
    },

    currentRevision() {
      return revision;
    },
  });
}
