# Copyright (C) 2025 Christian Lockley
# Licensed under GNU General Public License v3

# Tools
TERSER = npx terser
HTML_MINIFIER = npx html-minifier-terser
CSSO = npx csso
NODE = node

# Directories to exclude from JS/MJS search
EXCLUDES = -path "./node_modules/*" -o -path "./fonts/*" -o -path "./dist/*"

# Source and target files
CSS_SRC = src/main.css
CSS_MIN_MAP = src/main.min.css.map
HTML_SRC = src/index.html
HTML_PROD = src/index.prod.html

# Temporary files
TEMP_CSS = /tmp/minified_$(shell date +%s).css
TEMP_HTML = /tmp/html_with_css_$(shell date +%s).html

# Colors for output
COLOR_GREEN = \033[0;32m
COLOR_BLUE = \033[0;34m
COLOR_YELLOW = \033[1;33m
COLOR_RED = \033[0;31m
COLOR_RESET = \033[0m

# Find all JS/MJS source files excluding minified and excluded directories
JS_FILES := $(shell find ./src \( $(EXCLUDES) \) -prune -o -type f \( -name "*.js" -o -name "*.mjs" \) ! -name "*.min.*" -print)

# Corresponding minified files
MINIFIED_JS_FILES := $(patsubst %.js,%.min.js,$(patsubst %.mjs,%.min.mjs,$(JS_FILES)))

# Default target: generate CSS map first, then run js-minify and HTML build in parallel
.PHONY: all
all: check-deps $(CSS_MIN_MAP) js-minify $(HTML_PROD)
	@echo "$(COLOR_GREEN)✓ Build complete!$(COLOR_RESET)"

# Rule: Check dependencies
.PHONY: check-deps
check-deps:
	@echo "$(COLOR_BLUE)Checking dependencies...$(COLOR_RESET)"
	@command -v node >/dev/null 2>&1 || { echo "$(COLOR_RED)Error: node is required$(COLOR_RESET)" >&2; exit 1; }
	@command -v npx >/dev/null 2>&1 || { echo "$(COLOR_RED)Error: npx is required$(COLOR_RESET)" >&2; exit 1; }
	@$(NODE) -e "require('csso')" 2>/dev/null || { echo "$(COLOR_RED)Error: csso module required. Run: npm install csso$(COLOR_RESET)" >&2; exit 1; }
	@$(HTML_MINIFIER) --version >/dev/null 2>&1 || { echo "$(COLOR_RED)Error: html-minifier-terser required. Run: npm install html-minifier-terser$(COLOR_RESET)" >&2; exit 1; }
	@$(TERSER) --version >/dev/null 2>&1 || { echo "$(COLOR_RED)Error: terser required. Run: npm install terser$(COLOR_RESET)" >&2; exit 1; }

# Rule: Generate CSS source map (needed by HTML build)
$(CSS_MIN_MAP): $(CSS_SRC)
	@echo "$(COLOR_BLUE)Generating CSS source map...$(COLOR_RESET)"
	@$(NODE) -e "const csso = require('csso'); const fs = require('fs'); const css = fs.readFileSync('$(CSS_SRC)', 'utf8'); const result = csso.minify(css, { sourceMap: true, filename: '$(CSS_SRC)' }); fs.writeFileSync('$(CSS_MIN_MAP)', result.map.toString());"

# Rule: HTML build (with inlined minified CSS)
$(HTML_PROD): $(HTML_SRC) $(CSS_SRC) $(CSS_MIN_MAP)
	@echo "$(COLOR_BLUE)Building production HTML with inlined CSS...$(COLOR_RESET)"
	@# Generate minified CSS with source map reference
	@$(NODE) -e "const csso = require('csso'); const fs = require('fs'); const css = fs.readFileSync('$(CSS_SRC)', 'utf8'); const result = csso.minify(css, { sourceMap: true, filename: '$(CSS_SRC)' }); const minifiedCSS = result.css + '\n/*# sourceMappingURL=$(CSS_MIN_MAP) */'; fs.writeFileSync('$(TEMP_CSS)', minifiedCSS);"
	@# Inline minified CSS into HTML using awk
	@awk '/<link.*$(notdir $(CSS_SRC)).*>/ { \
		print "<style>"; \
		while ((getline line < "$(TEMP_CSS)") > 0) print line; \
		close("$(TEMP_CSS)"); \
		print "</style>"; \
		next; \
	} { print }' $(HTML_SRC) | \
	$(HTML_MINIFIER) --collapse-whitespace --remove-comments --minify-css false --minify-js true > $(HTML_PROD)
	@rm -f $(TEMP_CSS)
	@echo "$(COLOR_GREEN)✓ Created $(HTML_PROD)$(COLOR_RESET)"

# Rule: Minify all JS/MJS files (parallelized by make with -j)
.PHONY: js-minify
js-minify: $(MINIFIED_JS_FILES)
	@echo "$(COLOR_GREEN)✓ Minified all JS/MJS files$(COLOR_RESET)"

# Pattern rule to minify .js files
%.min.js: %.js
	@echo "$(COLOR_YELLOW)Minifying $< → $@$(COLOR_RESET)"
	@npx terser "$<" \
		--source-map "filename=$(notdir $<),url=$(notdir $@).map" \
		--compress \
		--mangle \
		--output "$@"

# Pattern rule to minify .mjs files
%.min.mjs: %.mjs
	@echo "$(COLOR_YELLOW)Minifying $< → $@$(COLOR_RESET)"
	@npx terser "$<" \
		--source-map "filename=$(notdir $<),url=$(notdir $@).map" \
		--compress \
		--mangle \
		--output "$@"

# Rule: Clean build artifacts
.PHONY: clean
clean:
	@echo "$(COLOR_BLUE)Cleaning build artifacts...$(COLOR_RESET)"
	@rm -f $(HTML_PROD) $(CSS_MIN_MAP) $(TEMP_CSS) $(TEMP_HTML)
	@find . \( $(EXCLUDES) \) -prune -o -type f \( -name "*.min.js" -o -name "*.min.mjs" -o -name "*.min.js.map" -o -name "*.min.mjs.map" \) -print0 | xargs -0 rm -f
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
	@echo "  HTML: $(HTML_SRC) $(if $(wildcard $(HTML_SRC)),$(COLOR_GREEN)[exists]$(COLOR_RESET),$(COLOR_RED)[missing]$(COLOR_RESET))"
	@echo "Build artifacts:"
	@echo "  Production HTML: $(HTML_PROD) $(if $(wildcard $(HTML_PROD)),$(COLOR_GREEN)[exists]$(COLOR_RESET),$(COLOR_YELLOW)[not built]$(COLOR_RESET))"
	@echo "  CSS Map: $(CSS_MIN_MAP) $(if $(wildcard $(CSS_MIN_MAP)),$(COLOR_GREEN)[exists]$(COLOR_RESET),$(COLOR_YELLOW)[not built]$(COLOR_RESET))"

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
