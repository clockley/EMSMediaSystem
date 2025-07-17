param (
    [string]$HtmlFile,
    [string]$CssFile,
    [string]$OutputFile,
    [string]$CssMapFile
)

# Read and minify CSS via node (you could also do this separately if you prefer)
$cssContent = Get-Content -Path $CssFile -Raw
$minifiedCss = node -e "const csso = require('csso'); const css=process.argv[1]; const result=csso.minify(css); console.log(result.css + '\n/*# sourceMappingURL=$CssMapFile */');" "$cssContent"

# Build regex to find the <link> tag for the CSS filename
$cssFileName = [System.IO.Path]::GetFileName($CssFile)
$regex = "<link[^>]*" + [regex]::Escape($cssFileName) + "[^>]*>"

# Read HTML and replace the <link> with the <style> tag containing minified CSS
$htmlContent = Get-Content -Path $HtmlFile -Raw
$inlinedHtml = $htmlContent -replace $regex, "<style>$minifiedCss</style>"

# Write the output file
$inlinedHtml | Out-File -FilePath $OutputFile -Encoding utf8 -NoNewline
