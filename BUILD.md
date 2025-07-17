# Building EMS Media System

This guide explains how to build the EMS Media System from source code on different platforms.

## Prerequisites

### All Platforms
- **Node.js** (v20 or higher) - [Download from nodejs.org](https://nodejs.org/)
- **Yarn** package manager - [Install instructions](https://yarnpkg.com/getting-started/install)

### Windows-Specific Prerequisites
- **Make** - Install using Windows Package Manager:
  ```cmd
  winget install GnuWin32.Make
  ```
  
  **Alternative installation methods:**
  - Download from [GnuWin32 project page](http://gnuwin32.sourceforge.net/packages/make.htm)

### Linux
- **Make** - Usually pre-installed. If not:
  - **Ubuntu/Debian**: `sudo apt install build-essential`
  - **CentOS/RHEL**: `sudo yum groupinstall "Development Tools"`

## Building Instructions

### 1. Clone the Repository
```
git clone <repository-url>
cd emsmediasystem
```

### 2. Install Dependencies
```
yarn install
```

This will install all required build tools and dependencies including:
- `csso` - CSS minification
- `html-minifier-terser` - HTML minification
- `terser` - JavaScript minification
- `electron` - Application runtime
- `electron-builder` - Distribution packaging

### 3. Build the Project
```
yarn build
```

This command:
- Minifies CSS files with source maps
- Processes HTML files for production
- Minifies JavaScript/ES modules
- Creates optimized files in the `derived/` directory

### 4. Run the Application
```
yarn start
```

This will build the project and launch the Electron application.

## Distribution Building

### Create Distributable Packages

**For current platform:**
```
yarn dist
```

**For specific platforms:**
```
# Windows installer
yarn dist-win

# Linux AppImage
yarn dist-linux

# Build for all platforms (requires platform-specific tools)
yarn dist-all
```

### Distribution Outputs
- **Windows**: NSIS installer (`.exe`)
- **Linux**: AppImage (`.AppImage`)

Built distributions will be created in the `dist/` directory.

## Build System Details

The project uses a custom Makefile-based build system accessed through Yarn scripts. **Always use Yarn commands instead of calling Make directly.**

### Cross-Platform Compatibility
- **Windows**: Uses PowerShell for file operations
- **Linux**: Uses standard Unix tools
- Automatically detects the operating system

### Build Process
1. **CSS Processing**: Minifies `src/main.css` and generates source maps
2. **HTML Processing**: Creates production HTML files with inlined CSS
3. **JavaScript Processing**: Minifies `.js` and `.mjs` files with source maps
4. **Electron Packaging**: Uses `electron-builder` for distribution

### Build Artifacts
- `derived/` - Minified and processed files
- `dist/` - Final distribution packages
- Source maps for debugging

## Troubleshooting

### Windows Issues

**Make not found:**
```cmd
# Verify make is installed
make --version

# If not found, ensure it's in PATH or reinstall
winget install GnuWin32.Make
```

**PowerShell execution policy:**
```powershell
# If you get execution policy errors
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### General Issues

**Node.js version:**
```bash
# Check Node.js version (should be v20+)
node --version

# Check Yarn version
yarn --version
```

**Clean build:**
```bash
# Clean all build artifacts
yarn clean

# Force rebuild
make rebuild
```

**Dependencies:**
```bash
# Reinstall all dependencies
rm -rf node_modules
yarn install
```

### Build Status
Check the current build status by examining the `derived/` directory for build artifacts.

## Development Workflow

1. **Make changes** to source files in `src/`
2. **Build** with `yarn build`
3. **Test** with `yarn start`
4. **Package** with `yarn dist`

### File Structure
```
emsmediasystem/
├── src/                    # Source files
│   ├── main.css           # Main stylesheet
│   ├── main.mjs           # Main application
│   └── *.html             # HTML templates
├── derived/               # Build artifacts (generated)
├── dist/                  # Distribution packages (generated)
├── build-scripts/         # Build helper scripts
├── Makefile              # Build configuration
└── package.json          # Dependencies and scripts
```

## License

This project is licensed under GPL-3.0-or-later. See the license header in the Makefile and source files for details.

## Support

If you encounter build issues:
1. Check this guide's troubleshooting section
2. Verify all prerequisites are installed
3. Try a clean build with `yarn clean && yarn build`
4. Check the project's issue tracker for known problems
