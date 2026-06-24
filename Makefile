# Copyright (C) 2025 Christian Lockley
# Licensed under GNU General Public License v3
#TODO: Add derived file path fixups for css, html, js and mjs files. This is needed to prevent refrencing the derived files in the source code.
.PHONY: all all-paid check-deps clean help js-minify rebuild status FORCE

# If any recipe step fails, remove the target instead of leaving a half-written (or empty) file.
.DELETE_ON_ERROR:

# Tools — use project-installed CLIs so a broken system `/usr/share/nodejs/terser`
# (or `npx` resolving outside this repo) cannot produce empty derived artifacts.
TERSER = $(NODE) node_modules/terser/bin/terser
HTML_MINIFIER = $(NODE) node_modules/html-minifier-terser/cli.js
CSSO = npx csso
ESBUILD = $(NODE) node_modules/esbuild/bin/esbuild
NODE = node
# ICON_SRC = src/icon.png # Covered by general image search

# Output directory for derived files
DERIVED_DIR = derived

# Output directory for dist files
DIST_DIR = dist

# Directories to exclude from JS/MJS search
EXCLUDES = -path "./node_modules/*" -o -path "./fonts/*" -o -path "./dist/*"

# Source and target files
CSS_SRC = src/main.css
CSS_MIN_MAP = $(DERIVED_DIR)/main.min.css.map

# --- Platform Setup and File Finding ---

ifeq ($(OS),Windows_NT)
  WINDOWS = 1
  NO_COLOR = 1
  MKDIR = powershell -NoProfile -c "New-Item -ItemType Directory -Force -Path"
  RMDIR = powershell -NoProfile -c "Remove-Item -Recurse -Force -Path"

  IMAGE_SRC := $(shell powershell -NoProfile -c ' \
  $$files = Get-ChildItem -Recurse -File -Filter "*.svg" -Path src; \
  $$files += Get-ChildItem -Recurse -File -Filter "*.png" -Path src; \
  $$files += Get-ChildItem -Recurse -File -Filter "*.ico" -Path src; \
  $$files = $$files | Where-Object { \
  $$_.FullName -notlike "*node_modules*" -and \
  $$_.FullName -notlike "*\.git*" -and \
  $$_.FullName -notlike "*build*" -and \
  $$_.FullName -notlike "*dist*" \
  }; \
  foreach ($$f in $$files) { "./" + $$f.FullName.Substring((Get-Location).Path.Length + 1).Replace("\\","/") }')

  HTML_FILES := $(shell powershell -NoProfile -c ' \
  $$files = Get-ChildItem -Recurse -File -Filter "*.html" src; \
  $$files = $$files | Where-Object { $$_.Name -notlike "*.prod.html" }; \
  foreach ($$f in $$files) { "./" + $$f.FullName.Substring((Get-Location).Path.Length + 1).Replace("\\","/") }')

  JS_FILES := $(shell powershell -NoProfile -c ' \
  $$files = Get-ChildItem -Recurse -File src | Where-Object { \
  ($$_.Extension -eq ".js" -or $$_.Extension -eq ".mjs") -and \
  $$_.Name -notlike "*.min.*" -and \
  $$_.FullName -notlike "*node_modules*" -and \
  $$_.FullName -notlike "*\.git*" -and \
  $$_.FullName -notlike "*build*" -and \
  $$_.FullName -notlike "*dist*" \
  }; \
  foreach ($$f in $$files) { "./" + $$f.FullName.Substring((Get-Location).Path.Length + 1).Replace("\\","/") }')
else
  WINDOWS = 0
  MKDIR = mkdir -p
  RMDIR = rm -rf

  IMAGE_SRC := $(shell find ./src \( $(EXCLUDES) \) -prune -o -type f \( -name "*.svg" -o -name "*.png" -o -name "*.ico" \) -print)

  HTML_FILES := $(shell find ./src -type f -name "*.html" ! -name "*.prod.html")

  JS_FILES := $(shell find ./src \( $(EXCLUDES) \) -prune -o -type f \( -name "*.js" -o -name "*.mjs" \) ! -name "*.min.*" -print)
endif

JS_FILES := $(patsubst ./%,%,$(JS_FILES))
JS_FILES := $(filter-out src/app.js src/Bible.mjs src/wasm_exec.js,$(JS_FILES))
APP_BUNDLE_SRC = src/app.js
APP_BUNDLE_OUT = $(DERIVED_DIR)/src/app.min.js
BIBLE_RPC_ROOT = sidecars/bible-rpc
BIBLE_PRIVATE_ROOT = private-bibles
BIBLE_RPC_ASSET_BUILDER = $(BIBLE_RPC_ROOT)/build-bible-assets.mjs
BIBLE_RPC_IMPORTER = $(BIBLE_RPC_ROOT)/import-bibles.mjs
BIBLE_PAID_METADATA = $(BIBLE_PRIVATE_ROOT)/bible-imports.json
BIBLE_PAID_JSONS = $(shell find "$(BIBLE_PRIVATE_ROOT)" -maxdepth 1 -type f -name "*.json" -print 2>/dev/null | sed 's/ /\\ /g')
BIBLE_SOURCE_DB = $(BIBLE_RPC_ROOT)/bible-sqlite.db
BUILD_ARTIFACTS_DIR = build-artifacts

# --- Go toolchain + Bible sidecar/database targets ---
#
# The Bible database and the Go sidecar are ordinary Make targets keyed off
# real file timestamps. No stamp files: Make rebuilds a target only when one of
# its prerequisites is newer (changed source JSONs, changed Go source, or an
# edition switch tracked by $(BIBLE_EDITION_RECORD)).

# Resolve a usable Go (>=1.22). Override with `make GO=/path/to/go`.
ifeq ($(WINDOWS), 1)
  GO ?= go
else
  GO ?= $(shell for c in /usr/local/go/bin/go go; do command -v "$$c" >/dev/null 2>&1 && { echo "$$c"; break; }; done)
endif

# Go source that produces the sidecar binary (edition independent).
BIBLE_RPC_GO_SOURCES = $(BIBLE_RPC_ROOT)/main.go $(BIBLE_RPC_ROOT)/internal/biblestore/text.go $(BIBLE_RPC_ROOT)/go.mod $(BIBLE_RPC_ROOT)/go.sum
# Go source for the DB optimizer the asset builder runs via `go run`.
BIBLE_OPTIMIZE_GO_SOURCES = $(BIBLE_RPC_ROOT)/cmd/bible-db-optimize/main.go $(BIBLE_RPC_ROOT)/internal/biblestore/text.go $(BIBLE_RPC_ROOT)/go.mod $(BIBLE_RPC_ROOT)/go.sum

# Final Bible artifacts the app loads at runtime.
BIBLE_DB_OUT = $(DERIVED_DIR)/bible/bible-sqlite.db
BIBLE_EDITION_RECORD = $(DERIVED_DIR)/bible/.edition

# Pick the edition from the requested goal (free/public by default).
BIBLE_EDITION := public
ifneq (,$(filter all-paid build-paid dist-all-paid,$(MAKECMDGOALS)))
  BIBLE_EDITION := paid
endif

# Prerequisites that, when changed, must rebuild the database for each edition.
BIBLE_DB_DEPS_public = $(BIBLE_RPC_ASSET_BUILDER) $(BIBLE_SOURCE_DB) $(BIBLE_OPTIMIZE_GO_SOURCES)
BIBLE_DB_DEPS_paid = $(BIBLE_DB_DEPS_public) $(BIBLE_RPC_IMPORTER) $(BIBLE_PAID_METADATA) $(BIBLE_PAID_JSONS)
BIBLE_DB_DEPS = $(BIBLE_DB_DEPS_$(BIBLE_EDITION))

# Sidecar binaries to produce. Cross-compile the shipped x64 targets and, when
# the host differs, also the host-native binary so dev (`yarn start`) can run.
BIBLE_SIDECAR_BINS := $(DERIVED_DIR)/bin/bible-rpc-linux-x64 $(DERIVED_DIR)/bin/bible-rpc-win32-x64.exe
$(DERIVED_DIR)/bin/bible-rpc-linux-x64: GOOS_T := linux
$(DERIVED_DIR)/bin/bible-rpc-linux-x64: GOARCH_T := amd64
$(DERIVED_DIR)/bin/bible-rpc-win32-x64.exe: GOOS_T := windows
$(DERIVED_DIR)/bin/bible-rpc-win32-x64.exe: GOARCH_T := amd64

ifneq ($(WINDOWS), 1)
  HOST_GOOS := $(shell $(GO) env GOOS 2>/dev/null)
  HOST_GOARCH := $(shell $(GO) env GOARCH 2>/dev/null)
  HOST_BIN_PLATFORM := $(if $(filter windows,$(HOST_GOOS)),win32,$(HOST_GOOS))
  HOST_BIN_ARCH := $(if $(filter amd64,$(HOST_GOARCH)),x64,$(HOST_GOARCH))
  HOST_BIN := $(DERIVED_DIR)/bin/bible-rpc-$(HOST_BIN_PLATFORM)-$(HOST_BIN_ARCH)$(if $(filter windows,$(HOST_GOOS)),.exe,)
  ifeq ($(filter $(HOST_BIN),$(BIBLE_SIDECAR_BINS)),)
    BIBLE_SIDECAR_BINS += $(HOST_BIN)
    $(HOST_BIN): GOOS_T := $(HOST_GOOS)
    $(HOST_BIN): GOARCH_T := $(HOST_GOARCH)
  endif
endif

# Corresponding destination files in derived directory.
# Maps "./src/path/file.ext" to "derived/src/path/file.ext"
IMAGE_DEST := $(patsubst ./%,$(DERIVED_DIR)/%,$(IMAGE_SRC))
DERIVED_RESOURCES = $(IMAGE_DEST) # Includes all copied binary/static resources
BIBLE_RESOURCES = $(BIBLE_SIDECAR_BINS) $(BIBLE_DB_OUT)

ifeq ($(NO_COLOR), 1)
  COLOR_GREEN =
  COLOR_BLUE =
  COLOR_YELLOW =
  COLOR_RED =
  COLOR_RESET =
  TICK = [OK]
else
  COLOR_GREEN = \033[0;32m
  COLOR_BLUE = \033[0;34m
  COLOR_YELLOW = \033[1;33m
  COLOR_RED = \033[0;31m
  COLOR_RESET = \033[0m
  TICK = ✓
endif

# Corresponding prod HTML files in derived directory
HTML_PROD_FILES := $(patsubst %.html,$(DERIVED_DIR)/%.prod.html,$(HTML_FILES))

# Corresponding minified files in derived directory
MINIFIED_JS_FILES := $(patsubst %.js,$(DERIVED_DIR)/%.min.js,$(patsubst %.mjs,$(DERIVED_DIR)/%.min.mjs,$(JS_FILES))) $(APP_BUNDLE_OUT)

# Default target
all: check-deps $(DERIVED_DIR) $(CSS_MIN_MAP) js-minify $(HTML_PROD_FILES) $(DERIVED_RESOURCES) $(BIBLE_RESOURCES)
	@echo "$(COLOR_GREEN)$($(TICK)) Build complete!$(COLOR_RESET)"

all-paid: check-deps $(DERIVED_DIR) $(CSS_MIN_MAP) js-minify $(HTML_PROD_FILES) $(DERIVED_RESOURCES) $(BIBLE_RESOURCES)
	@echo "$(COLOR_GREEN)$($(TICK)) Paid build complete!$(COLOR_RESET)"

# Ensure derived directory exists
$(DERIVED_DIR):
	@$(MKDIR) $(DERIVED_DIR)

# --- Pattern Rules for Copying Images (FIXED) ---

# This rule explicitly handles the copying for SVG, PNG, and ICO files
# by creating a pattern rule for each suffix. This avoids the shell
# complexity of the previous general rule and is more robust.

# Rule for SVG files
$(DERIVED_DIR)/%.svg: %.svg | $(DERIVED_DIR)
	@echo "$(COLOR_BLUE)Preparing directory for $@...$(COLOR_RESET)"
ifeq ($(WINDOWS), 1)
	@powershell -NoProfile -c "New-Item -ItemType Directory -Force -Path '$(dir $@)'" >nul 2>&1
else
	@mkdir -p $(dir $@)
endif
	@echo "$(COLOR_YELLOW)Copying $< → $@$(COLOR_RESET)"
	@cp "$<" "$@"
	@echo "$(COLOR_GREEN)$(TICK) Copied $@$(COLOR_RESET)"

# Rule for PNG files
$(DERIVED_DIR)/%.png: %.png | $(DERIVED_DIR)
	@echo "$(COLOR_BLUE)Preparing directory for $@...$(COLOR_RESET)"
ifeq ($(WINDOWS), 1)
	@powershell -NoProfile -c "New-Item -ItemType Directory -Force -Path '$(dir $@)'" >nul 2>&1
else
	@mkdir -p $(dir $@)
endif
	@echo "$(COLOR_YELLOW)Copying $< → $@$(COLOR_RESET)"
	@cp "$<" "$@"
	@echo "$(COLOR_GREEN)$(TICK) Copied $@$(COLOR_RESET)"

# Rule for ICO files
$(DERIVED_DIR)/%.ico: %.ico | $(DERIVED_DIR)
	@echo "$(COLOR_BLUE)Preparing directory for $@...$(COLOR_RESET)"
ifeq ($(WINDOWS), 1)
	@powershell -NoProfile -c "New-Item -ItemType Directory -Force -Path '$(dir $@)'" >nul 2>&1
else
	@mkdir -p $(dir $@)
endif
	@echo "$(COLOR_YELLOW)Copying $< → $@$(COLOR_RESET)"
	@cp "$<" "$@"
	@echo "$(COLOR_GREEN)$(TICK) Copied $@$(COLOR_RESET)"

# --- Bible RPC Go sidecar (built directly by Make) ---
#
# One recipe builds every requested sidecar binary. Each target carries its own
# GOOS_T/GOARCH_T (set above). The binary depends only on Go source, so an
# edition switch never rebuilds it — only a Go source change does.
$(BIBLE_SIDECAR_BINS): $(BIBLE_RPC_GO_SOURCES) | $(DERIVED_DIR)
ifeq ($(WINDOWS), 1)
	@powershell -NoProfile -c "New-Item -ItemType Directory -Force -Path '$(dir $@)'" >nul 2>&1
	@echo "$(COLOR_YELLOW)Building Bible RPC sidecar $(GOOS_T)/$(GOARCH_T) -> $@$(COLOR_RESET)"
	@powershell -NoProfile -c "$$env:CGO_ENABLED='0'; $$env:GOOS='$(GOOS_T)'; $$env:GOARCH='$(GOARCH_T)'; & '$(GO)' build -C '$(BIBLE_RPC_ROOT)' -trimpath -ldflags '-s -w' -o '$(CURDIR)/$@' '.'"
else
	@mkdir -p $(dir $@)
	@echo "$(COLOR_YELLOW)Building Bible RPC sidecar $(GOOS_T)/$(GOARCH_T) -> $@$(COLOR_RESET)"
	@CGO_ENABLED=0 GOOS=$(GOOS_T) GOARCH=$(GOARCH_T) "$(GO)" build -C "$(BIBLE_RPC_ROOT)" -trimpath -ldflags "-s -w" -o "$(CURDIR)/$@" .
	@[ "$(GOOS_T)" = "windows" ] || chmod 755 "$@"
endif
	@echo "$(COLOR_GREEN)$(TICK) Built $@$(COLOR_RESET)"

# --- Bible database ---
#
# The database is rebuilt only when its source inputs change or when the edition
# changes. $(BIBLE_EDITION_RECORD) holds the last-built edition; its mtime moves
# only on an actual public<->paid switch, which is what forces a rebuild then.
# FORCE is an always-out-of-date prerequisite so the record is re-evaluated every
# run, but it is only rewritten (mtime bumped) when the edition actually changes.
FORCE:

$(BIBLE_EDITION_RECORD): FORCE | $(DERIVED_DIR)
ifeq ($(WINDOWS), 1)
	@powershell -NoProfile -c "New-Item -ItemType Directory -Force -Path '$(dir $@)'" >nul 2>&1
	@powershell -NoProfile -c "if (-not (Test-Path '$@') -or ((Get-Content -Raw '$@') -ne '$(BIBLE_EDITION)')) { Set-Content -NoNewline -Path '$@' -Value '$(BIBLE_EDITION)' }"
else
	@mkdir -p $(dir $@)
	@printf '%s' "$(BIBLE_EDITION)" | cmp -s - "$@" 2>/dev/null || printf '%s' "$(BIBLE_EDITION)" > "$@"
endif

$(BIBLE_DB_OUT): $(BIBLE_DB_DEPS) $(BIBLE_EDITION_RECORD) | $(DERIVED_DIR)
ifeq ($(WINDOWS), 1)
	@powershell -NoProfile -c "New-Item -ItemType Directory -Force -Path '$(dir $@)'" >nul 2>&1
else
	@mkdir -p $(dir $@)
endif
	@echo "$(COLOR_YELLOW)Building $(BIBLE_EDITION) Bible database -> $@$(COLOR_RESET)"
	@BIBLE_PRIVATE_ROOT="$(BIBLE_PRIVATE_ROOT)" $(NODE) "$(BIBLE_RPC_ASSET_BUILDER)" $(BIBLE_EDITION) "$(DERIVED_DIR)"
	@echo "$(COLOR_GREEN)$(TICK) Built $(BIBLE_EDITION) Bible database$(COLOR_RESET)"


# Rule: Check dependencies
check-deps:
	@echo "$(COLOR_BLUE)Checking dependencies...$(COLOR_RESET)"
	@command -v node >/dev/null 2>&1 || { echo "$(COLOR_RED)Error: node is required$(COLOR_RESET)" >&2; exit 1; }
	@test -f node_modules/terser/bin/terser || { echo "$(COLOR_RED)Error: terser not found in node_modules. Run: yarn install$(COLOR_RESET)" >&2; exit 1; }
	@test -f node_modules/esbuild/bin/esbuild || { echo "$(COLOR_RED)Error: esbuild not found in node_modules. Run: yarn install$(COLOR_RESET)" >&2; exit 1; }
	@test -f node_modules/html-minifier-terser/cli.js || { echo "$(COLOR_RED)Error: html-minifier-terser not found in node_modules. Run: yarn install$(COLOR_RESET)" >&2; exit 1; }
	@$(NODE) -e "require('csso')" 2>/dev/null || { echo "$(COLOR_RED)Error: csso module required. Run: npm install csso$(COLOR_RESET)" >&2; exit 1; }
	@$(HTML_MINIFIER) --version >/dev/null 2>&1 || { echo "$(COLOR_RED)Error: html-minifier-terser required. Run: npm install html-minifier-terser$(COLOR_RESET)" >&2; exit 1; }
	@$(TERSER) --version >/dev/null 2>&1 || { echo "$(COLOR_RED)Error: terser required. Run: npm install terser$(COLOR_RESET)" >&2; exit 1; }
	@command -v sqlite3 >/dev/null 2>&1 || { echo "$(COLOR_RED)Error: sqlite3 is required$(COLOR_RESET)" >&2; exit 1; }
	@$(NODE) -e "const {spawnSync}=require('node:child_process'); const supported=(out)=>{const m=String(out||'').match(/go(\\d+)\\.(\\d+)/); return !!m && (Number(m[1])>1 || Number(m[2])>=22);}; for (const c of [process.env.GO,'/usr/local/go/bin/go','go'].filter(Boolean)) { const r=spawnSync(c,['version'],{encoding:'utf8'}); if (r.status===0 && supported(r.stdout)) process.exit(0); } process.exit(1);" || { echo "$(COLOR_RED)Error: Go 1.22+ is required$(COLOR_RESET)" >&2; exit 1; }

# Rule: Generate CSS source map
$(CSS_MIN_MAP): $(CSS_SRC)
	@echo "$(COLOR_BLUE)Generating CSS source map...$(COLOR_RESET)"
	@$(NODE) -e "const csso = require('csso'); const fs = require('fs'); const css = fs.readFileSync('$(CSS_SRC)', 'utf8'); const result = csso.minify(css, { sourceMap: true, filename: '$(CSS_SRC)' }); fs.writeFileSync('$(CSS_MIN_MAP)', result.map.toString());"

# Pattern rule: build .prod.html
ifeq ($(WINDOWS), 1)
  $(DERIVED_DIR)/%.prod.html: %.html $(CSS_SRC) $(CSS_MIN_MAP)
	@powershell -NoProfile -c "New-Item -ItemType Directory -Force -Path '$(dir $@)'" >nul 2>&1
	@echo "$(COLOR_BLUE)Building production HTML for $< with pruned inlined CSS...$(COLOR_RESET)"
	@$(NODE) build-scripts/inline-pruned-css.cjs --html "$<" --css "$(CSS_SRC)" --out "$@"
	@echo "$(COLOR_GREEN)$(TICK) Created $@$(COLOR_RESET)"
else
  $(DERIVED_DIR)/%.prod.html: %.html $(CSS_SRC) $(CSS_MIN_MAP)
	@mkdir -p $(dir $@)
	@echo "$(COLOR_BLUE)Building production HTML for $< with pruned inlined CSS...$(COLOR_RESET)"
	@$(NODE) build-scripts/inline-pruned-css.cjs --html "$<" --css "$(CSS_SRC)" --out "$@"
	@echo "$(COLOR_GREEN)$(TICK) Created $@$(COLOR_RESET)"
endif

# Rule: Minify all JS/MJS files
js-minify: $(MINIFIED_JS_FILES)
	@echo "$(COLOR_GREEN)$(TICK) Minified all JS/MJS files$(COLOR_RESET)"

# Pattern rule to minify .js files
$(APP_BUNDLE_OUT): $(APP_BUNDLE_SRC) src/app-media-utils.mjs src/app-bible-reference-utils.mjs src/app-pptx-utils.mjs src/app-controls-utils.mjs src/app-media-loading-utils.mjs src/app-ui-templates.mjs Makefile | $(DERIVED_DIR)
ifeq ($(WINDOWS), 1)
	@powershell -NoProfile -c "New-Item -ItemType Directory -Force -Path '$(dir $@)'" >nul 2>&1
else
	@mkdir -p $(dir $@)
endif
	@echo "$(COLOR_YELLOW)Bundling $(APP_BUNDLE_SRC) → $@$(COLOR_RESET)"
	@$(ESBUILD) "$(APP_BUNDLE_SRC)" \
		--bundle \
		--format=iife \
		--platform=browser \
		--target=chrome120 \
		--tree-shaking=true \
		--minify \
		--legal-comments=none \
		--drop:debugger \
		--outfile="$@"

$(DERIVED_DIR)/%.min.js: %.js | $(DERIVED_DIR)
ifeq ($(WINDOWS), 1)
	@powershell -NoProfile -c "New-Item -ItemType Directory -Force -Path '$(dir $@)'" >nul 2>&1
else
	@mkdir -p $(dir $@)
endif
	@echo "$(COLOR_YELLOW)Checking $<$(COLOR_RESET)"
	@$(NODE) --check "$<"
	@echo "$(COLOR_YELLOW)Minifying $< → $@$(COLOR_RESET)"
	@$(TERSER) "$<" \
		--compress \
		--mangle \
		--output "$@"

# Pattern rule to minify .mjs files
$(DERIVED_DIR)/%.min.mjs: %.mjs | $(DERIVED_DIR)
ifeq ($(WINDOWS), 1)
	@powershell -NoProfile -c "New-Item -ItemType Directory -Force -Path '$(dir $@)'" >nul 2>&1
else
	@mkdir -p $(dir $@)
endif
	@echo "$(COLOR_YELLOW)Checking $<$(COLOR_RESET)"
	@$(NODE) --check "$<"
	@echo "$(COLOR_YELLOW)Minifying $< → $@$(COLOR_RESET)"
	@$(TERSER) "$<" \
		--compress \
		--mangle \
		--output "$@"

# Rule: Clean build artifacts
clean:
	@echo "$(COLOR_BLUE)Cleaning build artifacts...$(COLOR_RESET)"
ifeq ($(WINDOWS), 1)
	@powershell -NoProfile -c "if (Test-Path '$(DERIVED_DIR)') { Remove-Item -Recurse -Force -Path '$(DERIVED_DIR)' }" 2>nul || true
	@powershell -NoProfile -c "if (Test-Path '$(DIST_DIR)') { Remove-Item -Recurse -Force -Path '$(DIST_DIR)' }" 2>nul || true
else
	@rm -rf $(DERIVED_DIR)
	@rm -rf $(DIST_DIR)
	@rm -rf $(BUILD_ARTIFACTS_DIR)
endif
	@echo "$(COLOR_GREEN)$(TICK) Clean complete$(COLOR_RESET)"

# Rule: Force rebuild
rebuild: clean all

# Rule: Show build status
status:
	@echo "$(COLOR_BLUE)Build Status:$(COLOR_RESET)"
	@echo "Source files:"
	@echo "  CSS: $(CSS_SRC) $(if $(wildcard $(CSS_SRC)),$(COLOR_GREEN)[exists]$(COLOR_RESET),$(COLOR_RED)[missing]$(COLOR_RESET))"
	@echo "  HTML files: $(HTML_FILES)"
	@echo "Build artifacts:"
	@echo "  Production HTML files: $(HTML_PROD_FILES) $(if $(wildcard $(HTML_PROD_FILES)),$(COLOR_GREEN)[exists]$(COLOR_RESET),$(COLOR_YELLOW)[not built]$(COLOR_RESET))"
	@echo "  Derived: $(DERIVED_DIR)/ $(if $(wildcard $(DERIVED_DIR)/*),$(COLOR_GREEN)[exists]$(COLOR_RESET),$(COLOR_YELLOW)[empty]$(COLOR_RESET))"

# Rule: Show help
help:
	@echo "$(COLOR_RED)Warning: This Makefile is intended to be run via yarn scripts, not directly.$(COLOR_RESET)"
	@echo ""
	@echo "$(COLOR_BLUE)Available targets:$(COLOR_RESET)"
	@echo "  $(COLOR_GREEN)all$(COLOR_RESET)       - Build all artifacts (default)"
	@echo "  $(COLOR_GREEN)all-paid$(COLOR_RESET)  - Build all artifacts with paid Bible content"
	@echo "  $(COLOR_GREEN)clean$(COLOR_RESET)     - Remove all build artifacts"
	@echo "  $(COLOR_GREEN)rebuild$(COLOR_RESET)   - Clean and build all artifacts"
	@echo "  $(COLOR_GREEN)status$(COLOR_RESET)    - Show build status"
	@echo "  $(COLOR_GREEN)help$(COLOR_RESET)      - Show this help message"
