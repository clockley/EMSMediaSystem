# Copyright (C) 2025 Christian Lockley
# Licensed under GNU General Public License v3

# Tools
TERSER = npx terser
HTML_MINIFIER = npx html-minifier-terser
CSSO = npx csso
NODE = node

# Output directory for derived files
DERIVED_DIR = derived

# Output directory for dist files
DIST_DIR = dist

# Directories to exclude from JS/MJS search
EXCLUDES = -path "./node_modules/*" -o -path "./fonts/*" -o -path "./dist/*"

# Source and target files
CSS_SRC = src/main.css
CSS_MIN_MAP = $(DERIVED_DIR)/main.min.css.map

# Find all HTML source files (except .prod.html)
HTML_FILES := $(shell find ./src -type f -name "*.html" ! -name "*.prod.html")
# Corresponding prod HTML files in derived directory
HTML_PROD_FILES := $(patsubst %.html,$(DERIVED_DIR)/%.prod.html,$(HTML_FILES))

# Find all JS/MJS source files excluding minified and excluded directories
JS_FILES := $(shell find ./src \( $(EXCLUDES) \) -prune -o -type f \( -name "*.js" -o -name "*.mjs" \) ! -name "*.min.*" -print)
# Corresponding minified files in derived directory
MINIFIED_JS_FILES := $(patsubst %.js,$(DERIVED_DIR)/%.min.js,$(patsubst %.mjs,$(DERIVED_DIR)/%.min.mjs,$(JS_FILES)))

# Colors for output
COLOR_GREEN = \033[0;32m
COLOR_BLUE = \033[0;34m
COLOR_YELLOW = \033[1;33m
COLOR_RED = \033[0;31m
COLOR_RESET = \033[0m

# Default target
.PHONY: all
all: check-deps $(DERIVED_DIR) $(CSS_MIN_MAP) js-minify $(HTML_PROD_FILES)
	@echo "$(COLOR_GREEN)✓ Build complete!$(COLOR_RESET)"

# Ensure derived directory exists
$(DERIVED_DIR):
	@mkdir -p $(DERIVED_DIR)

# Rule: Check dependencies
.PHONY: check-deps
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
$(DERIVED_DIR)/%.prod.html: %.html $(CSS_SRC) $(CSS_MIN_MAP)
	@mkdir -p $(dir $@)
	@echo "$(COLOR_BLUE)Building production HTML for $< with inlined CSS...$(COLOR_RESET)"
	@$(NODE) -e "const csso = require('csso'); const fs = require('fs'); const css = fs.readFileSync('$(CSS_SRC)', 'utf8'); const result = csso.minify(css, { sourceMap: true, filename: '$(CSS_SRC)' }); console.log(result.css + '\n/*# sourceMappingURL=$(CSS_MIN_MAP) */');" | \
	awk -v pat="$(notdir $(CSS_SRC))" ' \
		BEGIN { css_line_count = 0; while ((getline line < "-") > 0) css[css_line_count++] = line } \
		FNR==1 { close("-") } \
		{ if ($$0 ~ "<link" && $$0 ~ pat) { print "<style>"; for (i = 0; i < css_line_count; ++i) print css[i]; print "</style>"; } else print $$0; }' $< | \
	$(HTML_MINIFIER) --collapse-whitespace --remove-comments --minify-css false --minify-js true > $@
	@echo "$(COLOR_GREEN)✓ Created $@$(COLOR_RESET)"

# Rule: Minify all JS/MJS files
.PHONY: js-minify
js-minify: $(MINIFIED_JS_FILES)
	@echo "$(COLOR_GREEN)✓ Minified all JS/MJS files$(COLOR_RESET)"

# Pattern rule to minify .js files
$(DERIVED_DIR)/%.min.js: %.js | $(DERIVED_DIR)
	@mkdir -p $(dir $@)
	@echo "$(COLOR_YELLOW)Minifying $< → $@$(COLOR_RESET)"
	@$(TERSER) "$<" \
		--source-map "filename=$(notdir $<),url=$(notdir $@).map" \
		--compress \
		--mangle \
		--output "$@"

# Pattern rule to minify .mjs files
$(DERIVED_DIR)/%.min.mjs: %.mjs | $(DERIVED_DIR)
	@mkdir -p $(dir $@)
	@echo "$(COLOR_YELLOW)Minifying $< → $@$(COLOR_RESET)"
	@$(TERSER) "$<" \
		--source-map "filename=$(notdir $<),url=$(notdir $@).map" \
		--compress \
		--mangle \
		--output "$@"

# Rule: Clean build artifacts
.PHONY: clean
clean:
	@echo "$(COLOR_BLUE)Cleaning build artifacts...$(COLOR_RESET)"
	@rm -rf $(DERIVED_DIR)
	@rm -rf $(DIST_DIR)
	@echo "$(COLOR_GREEN)✓ Clean complete$(COLOR_RESET)"

# Rule: Force rebuild
.PHONY: rebuild
rebuild: clean all

# Rule: Show build status
.PHONY: status
status:
	@echo "$(COLOR_BLUE)Build Status:$(COLOR_RESET)"
	@echo "Source files:"
	@echo "  CSS: $(CSS_SRC) $(if $(wildcard $(CSS_SRC)),$(COLOR_GREEN)[exists]$(COLOR_RESET),$(COLOR_RED)[missing]$(COLOR_RESET))"
	@echo "  HTML files: $(HTML_FILES)"
	@echo "Build artifacts:"
	@echo "  Production HTML files: $(HTML_PROD_FILES) $(if $(wildcard $(HTML_PROD_FILES)),$(COLOR_GREEN)[exists]$(COLOR_RESET),$(COLOR_YELLOW)[not built]$(COLOR_RESET))"
	@echo "  Derived: $(DERIVED_DIR)/ $(if $(wildcard $(DERIVED_DIR)/*),$(COLOR_GREEN)[exists]$(COLOR_RESET),$(COLOR_YELLOW)[empty]$(COLOR_RESET))"

# Rule: Show help
.PHONY: help
help:
	@echo "$(COLOR_RED)Warning: This Makefile is intended to be run via yarn scripts, not directly.$(COLOR_RESET)"
	@echo ""
	@echo "$(COLOR_BLUE)Available targets:$(COLOR_RESET)"
	@echo "  $(COLOR_GREEN)all$(COLOR_RESET)       - Build all artifacts (default)"
	@echo "  $(COLOR_GREEN)clean$(COLOR_RESET)     - Remove all build artifacts"
	@echo "  $(COLOR_GREEN)rebuild$(COLOR_RESET)   - Clean and build all artifacts"
	@echo "  $(COLOR_GREEN)status$(COLOR_RESET)    - Show build status"
	@echo "  $(COLOR_GREEN)help$(COLOR_RESET)      - Show this help message"
