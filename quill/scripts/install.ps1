$Version = $args[0] ?? "latest"
$InstallDir = "$env:USERPROFILE\.quill\bin"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

if ($Version -eq "latest") {
    $Resp = Invoke-RestMethod "https://api.github.com/repos/inklang/quill/releases/latest"
    $Version = $Resp.tag_name
}

$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq "AMD64") { "x86_64" } else { "aarch64" }
$OS = "windows"
$Artifact = "quill-${Arch}-windows.tar.gz"
$Url = "https://github.com/inklang/quill/releases/download/${Version}/${Artifact}"
$Temp = [System.IO.Path]::GetTempFileName() + ".tar.gz"

Invoke-WebRequest -Uri $Url -OutFile $Temp
tar -xzf $Temp -C $InstallDir
Remove-Item $Temp

$QuillExe = Join-Path $InstallDir "quill.exe"
Write-Host "Installed quill ${Version} to ${InstallDir}"
