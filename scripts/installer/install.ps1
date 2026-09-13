param(
    [string]$Vault,
    [string]$PluginDir,
    [switch]$Yes
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PluginId = "buchhaltzar"
$PluginFiles = @("manifest.json", "main.js", "styles.css")

function Resolve-PluginDir {
    param([string]$Override)
    if ($Override) { return (Resolve-Path $Override).Path }
    $nested = Join-Path $ScriptDir $PluginId
    if (Test-Path (Join-Path $nested "manifest.json")) { return $nested }
    if (Test-Path (Join-Path $ScriptDir "manifest.json")) { return $ScriptDir }
    throw "Рядом с установщиком нет папки buchhaltzar с файлами плагина."
}

function Get-KnownVaults {
    $config = Join-Path $env:APPDATA "obsidian\obsidian.json"
    if (-not (Test-Path $config)) { return @() }
    $data = Get-Content -Raw -Encoding UTF8 $config | ConvertFrom-Json
    $vaults = @()
    if ($data.vaults) {
        foreach ($item in $data.vaults.PSObject.Properties) {
            $path = $item.Value.path
            if ($path -and (Test-Path $path)) {
                $vaults += [pscustomobject]@{ Name = Split-Path $path -Leaf; Path = $path }
            }
        }
    }
    return $vaults | Sort-Object Name
}

$source = Resolve-PluginDir $PluginDir
foreach ($name in $PluginFiles) {
    if (-not (Test-Path (Join-Path $source $name))) {
        throw "В $source нет файла $name"
    }
}

if (-not $Vault) {
    $vaults = @(Get-KnownVaults)
    if ($vaults.Count -eq 0) {
        $Vault = Read-Host "Obsidian ещё не знает хранилищ. Путь к папке vault"
    } elseif (Get-Command Out-GridView -ErrorAction SilentlyContinue) {
        $selected = $vaults | Out-GridView -Title "Куда установить Buchhaltzar?" -PassThru
        if (-not $selected) { throw "Установка отменена." }
        $Vault = $selected.Path
    } else {
        Write-Host "Найденные хранилища Obsidian:"
        for ($i = 0; $i -lt $vaults.Count; $i++) {
            Write-Host ("  {0}. {1}`n     {2}" -f ($i + 1), $vaults[$i].Name, $vaults[$i].Path)
        }
        $raw = Read-Host "Номер хранилища"
        $Vault = $vaults[[int]$raw - 1].Path
    }
}

if (-not $Yes) {
    $confirm = Read-Host "Установить Buchhaltzar в $Vault ? [y/N]"
    if ($confirm -notmatch '^(y|yes|д|да)$') { throw "Установка отменена." }
}

$target = Join-Path $Vault ".obsidian\plugins\$PluginId"
New-Item -ItemType Directory -Force -Path $target | Out-Null
foreach ($name in $PluginFiles) {
    Copy-Item -Force (Join-Path $source $name) (Join-Path $target $name)
}

$configPath = Join-Path $Vault ".obsidian\community-plugins.json"
$enabled = @()
if (Test-Path $configPath) {
    try {
        $parsed = Get-Content -Raw -Encoding UTF8 $configPath | ConvertFrom-Json
        if ($parsed -is [System.Array]) { $enabled = @($parsed) }
        elseif ($parsed) { $enabled = @($parsed) }
    } catch {
        $enabled = @()
    }
}
if ($enabled -notcontains $PluginId) {
    $enabled += $PluginId
    $json = ($enabled | ConvertTo-Json -Compress)
    if ($json[0] -ne "[") { $json = "[$json]" }
    Set-Content -Path $configPath -Value $json -Encoding UTF8
}

Write-Host "Buchhaltzar установлен в $target"
Write-Host "Откройте это хранилище в Obsidian, разрешите сторонние плагины и включите Buchhaltzar."
