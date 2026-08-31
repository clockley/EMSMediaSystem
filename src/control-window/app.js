/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

"use strict";

// The stable renderer entry point. esbuild follows this static import and
// flattens the complete module graph into the existing single IIFE bundle.
import "./app-renderer.mjs";
