# Copyright (C) 2025 Christian Lockley
# Licensed under GNU General Public License v3
#TODO: Add derived file path fixups for css, html, js and mjs files. This is needed to prevent refrencing the derived files in the source code.
.PHONY: all check-deps clean help js-minify rebuild status

# Tools
TERSER = npx terser
HTML_MINIFIER = npx html-minifier-terser
CSSO = npx csso
NODE = node
ICON_SRC = src/icon.png

# Output directory for derived files
DERIVED_DIR = derived

# Output directory for dist files
DIST_DIR = dist

ICON_DEST = $(DERIVED_DIR)/$(ICON_SRC)
DERIVED_RESOURCES = $(ICON_DEST)

# Directories to exclude from JS/MJS search
EXCLUDES = -path "./node_modules/*" -o -path "./fonts/*" -o -path "./dist/*"

# Source and target files
CSS_SRC = src/main.css
CSS_MIN_MAP = $(DERIVED_DIR)/main.min.css.map

ifeq ($(OS),Windows_NT)
  WINDOWS = 1
  NO_COLOR = 1
  MKDIR = powershell -NoProfile -c "New-Item -ItemType Directory -Force -Path"
  RMDIR = powershell -NoProfile -c "Remove-Item -Recurse -Force -Path"
else
  WINDOWS = 0
  MKDIR = mkdir -p
  RMDIR = rm -rf
endif

ifeq ($(WINDOWS), 1)
  HTML_FILES := $(shell powershell -NoProfile -c ' \
  $$files = Get-ChildItem -Recurse -File -Filter "*.html" src; \
  $$files = $$files | Where-Object { $$_.Name -notlike "*.prod.html" }; \
  foreach ($$f in $$files) { "./" + $$f.FullName.Substring((Get-Location).Path.Length + 1).Replace("\\","/") }')
else
  HTML_FILES := $(shell find ./src -type f -name "*.html" ! -name "*.prod.html")
endif

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

ifeq ($(WINDOWS), 1)
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
  JS_FILES := $(shell find ./src \( $(EXCLUDES) \) -prune -o -type f \( -name "*.js" -o -name "*.mjs" \) ! -name "*.min.*" -print)
endif

# Corresponding minified files in derived directory
MINIFIED_JS_FILES := $(patsubst %.js,$(DERIVED_DIR)/%.min.js,$(patsubst %.mjs,$(DERIVED_DIR)/%.min.mjs,$(JS_FILES)))

# Default target
all: check-deps $(DERIVED_DIR) $(CSS_MIN_MAP) js-minify $(HTML_PROD_FILES) $(DERIVED_RESOURCES)
	@echo "$(COLOR_GREEN)$($(TICK)) Build complete!$(COLOR_RESET)"

# Ensure derived directory exists
$(DERIVED_DIR):
	@$(MKDIR) $(DERIVED_DIR)

$(ICON_DEST): $(ICON_SRC) | $(DERIVED_DIR)
ifeq ($(WINDOWS), 1)
	@powershell -NoProfile -c "New-Item -ItemType Directory -Force -Path '$(dir $@)'" >nul 2>&1
else
	@mkdir -p $(dir $@)
endif
	@echo "$(COLOR_YELLOW)Copying $< → $@$(COLOR_RESET)"
	@cp "$<" "$@"
	@echo "$(COLOR_GREEN)$(TICK) Copied $@$(COLOR_RESET)"

# Rule: Check dependencies
check-deps:
	@echo "$(COLOR_BLUE)Checking dependencies...$(COLOR_RESET)"
	@command -v node >/dev/null 2>&1 || { echo "$(COLOR_RED)Error: node is required$(COLOR_RESET)" >&2; exit 1; }
	@command -v npx >/dev/null 2>&1 || { echo "$(COLOR_RED)Error: npx is required$(COLOR_RESET)" >&2; exit 1; }
	@$(NODE) -e "require('csso')" 2>/dev/null || { echo "$(COLOR_RED)Error: csso module required. Run: npm install csso$(COLOR_RESET)" >&2; exit 1; }
	@$(HTML_MINIFIER) --version >/dev/null 2>&1 || { echo "$(COLOR_RED)Error: html-minifier-terser required. Run: npm install html-minifier-terser$(COLOR_RESET)" >&2; exit 1; }
	@$(TERSER) --version >/dev/null 2>&1 || { echo "$(COLOR_RED)Error: terser required. Run: npm install terser$(COLOR_RESET)" >&2; exit 1; }

# Rule: Generate CSS source map
$(CSS_MIN_MAP): $(CSS_SRC)
	@echo "$(COLOR_BLUE)Generating CSS source map...$(COLOR_RESET)"
	@$(NODE) -e "const csso = require('csso'); const fs = require('fs'); const css = fs.readFileSync('$(CSS_SRC)', 'utf8'); const result = csso.minify(css, { sourceMap: true, filename: '$(CSS_SRC)' }); fs.writeFileSync('$(CSS_MIN_MAP)', result.map.toString());"

# Pattern rule: build .prod.html
ifeq ($(WINDOWS), 1)
  $(DERIVED_DIR)/%.prod.html: %.html $(CSS_SRC) $(CSS_MIN_MAP)
	@powershell -NoProfile -c "New-Item -ItemType Directory -Force -Path '$(dir $@)'" >nul 2>&1
	@echo "$(COLOR_BLUE)Building production HTML for $< with inlined CSS...$(COLOR_RESET)"
	powershell -NoProfile -ExecutionPolicy Bypass -File build-scripts/embed-css.ps1 -HtmlFile "$<" -CssFile "$(CSS_SRC)" -OutputFile "$@" -CssMapFile "$(CSS_MIN_MAP)"
	@echo "$(COLOR_GREEN)$(TICK) Created $@$(COLOR_RESET)"
else
  $(DERIVED_DIR)/%.prod.html: %.html $(CSS_SRC) $(CSS_MIN_MAP)
	@mkdir -p $(dir $@)
	@echo "$(COLOR_BLUE)Building production HTML for $< with inlined CSS...$(COLOR_RESET)"
	@$(NODE) -e "const csso = require('csso'); const fs = require('fs'); const css = fs.readFileSync('$(CSS_SRC)', 'utf8'); const result = csso.minify(css, { sourceMap: true, filename: '$(CSS_SRC)' }); console.log(result.css + '\n/*# sourceMappingURL=$(CSS_MIN_MAP) */');" | \
	awk -v pat="$(notdir $(CSS_SRC))" ' \
		BEGIN { css_line_count = 0; while ((getline line < "-") > 0) css[css_line_count++] = line } \
		FNR==1 { close("-") } \
		{ if ($$0 ~ "<link" && $$0 ~ pat) { print "<style>"; for (i = 0; i < css_line_count; ++i) print css[i]; print "</style>"; } else print $$0; }' $< | \
	$(HTML_MINIFIER) --collapse-whitespace --remove-comments --minify-css false --minify-js true > $@
	@echo "$(COLOR_GREEN)$(TICK) Created $@$(COLOR_RESET)"
endif

# Rule: Minify all JS/MJS files
js-minify: $(MINIFIED_JS_FILES)
	@echo "$(COLOR_GREEN)$(TICK) Minified all JS/MJS files$(COLOR_RESET)"

# Pattern rule to minify .js files
$(DERIVED_DIR)/%.min.js: %.js | $(DERIVED_DIR)
ifeq ($(WINDOWS), 1)
	@powershell -NoProfile -c "New-Item -ItemType Directory -Force -Path '$(dir $@)'" >nul 2>&1
else
	@mkdir -p $(dir $@)
endif
	@echo "$(COLOR_YELLOW)Minifying $< → $@$(COLOR_RESET)"
	@$(TERSER) "$<" \
		--source-map "filename=$(notdir $<),url=$(notdir $@).map" \
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
	@echo "$(COLOR_YELLOW)Minifying $< → $@$(COLOR_RESET)"
	@$(TERSER) "$<" \
		--source-map "filename=$(notdir $<),url=$(notdir $@).map" \
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
	@echo "  $(COLOR_GREEN)clean$(COLOR_RESET)     - Remove all build artifacts"
	@echo "  $(COLOR_GREEN)rebuild$(COLOR_RESET)   - Clean and build all artifacts"
	@echo "  $(COLOR_GREEN)status$(COLOR_RESET)    - Show build status"
	@echo "  $(COLOR_GREEN)help$(COLOR_RESET)      - Show this help message"
