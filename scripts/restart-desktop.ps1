param([switch]$NoUI, [switch]$NoBrowser, [string]$StatusFile, [string]$ResultFile)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$browserUrl = $null
$runtimeDir = Join-Path $env:LOCALAPPDATA 'Museboard\launcher'
$statePath = Join-Path $runtimeDir 'server.json'
$mutex = New-Object System.Threading.Mutex($false, 'Local\MuseboardDesktopRestart')
$locked = $false
$startedServer = $null
$completed = $false

function Show-Notice([string]$Message, [bool]$Failed = $false) {
    if ($ResultFile) { @{ message = $Message; failed = $Failed } | ConvertTo-Json | Set-Content -LiteralPath $ResultFile -Encoding UTF8 }
    if ($NoUI) { Write-Output $Message; return }
    $shell = New-Object -ComObject WScript.Shell
    $icon = if ($Failed) { 16 } else { 64 }
    # System-modal so the notification remains visible when the browser takes focus.
    [void]$shell.Popup($Message, 0, 'Museboard 项目重启', ($icon + 4096))
}

function Set-Stage([string]$Message) {
    if ($StatusFile) { Set-Content -LiteralPath $StatusFile -Value $Message -Encoding UTF8 }
}

function Get-Listener([int]$Port) {
    @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
}

function Get-Health([int]$Port) {
    try { Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3 -ErrorAction Stop }
    catch { $null }
}

function Stop-ManagedServer($State) {
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$($State.pid)" -ErrorAction SilentlyContinue
    if (!$existing) { return }
    $wrapper = Join-Path $PSScriptRoot 'desktop-server.cjs'
    if ($existing.Name -ne 'node.exe' -or !$existing.CommandLine.Contains($wrapper) -or
        $existing.CreationDate.ToUniversalTime().ToString('o') -ne $State.createdAt) {
        throw '启动记录与运行中的进程不匹配，已取消重启。'
    }
    $pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', "museboard-desktop-$($State.pid)", [System.IO.Pipes.PipeDirection]::Out)
    try {
        $pipe.Connect(3000)
        $writer = New-Object System.IO.StreamWriter($pipe)
        $writer.WriteLine("stop $($State.token)")
        $writer.Flush()
    } finally { $pipe.Dispose() }
    $process = Get-Process -Id $State.pid -ErrorAction SilentlyContinue
    if ($process -and !$process.WaitForExit(45000)) {
        throw '旧服务未能在 45 秒内安全退出，已取消启动新服务。'
    }
}

try {
    try { $locked = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (!$locked) {
        if ($ResultFile) { @{ ignored = $true } | ConvertTo-Json | Set-Content -LiteralPath $ResultFile -Encoding UTF8 }
        exit 0
    }
    [void](New-Item -ItemType Directory -Path $runtimeDir -Force)
    Set-Stage '正在检查运行环境…'

    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $npmCli = Join-Path (Split-Path $nodePath) 'node_modules\npm\bin\npm-cli.js'
    if (!(Test-Path -LiteralPath $npmCli)) { throw '未找到 npm，请确认 Node.js 和 npm 已安装并加入 PATH。' }
    $version = & $nodePath --version
    if ($LASTEXITCODE -ne 0 -or [int]($version.TrimStart('v').Split('.')[0]) -lt 24) { throw '项目需要 Node.js 24 或更高版本。' }
    if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) { throw '缺少 node_modules，请先在项目目录执行 npm install。' }

    # Let Node parse .env exactly as it does for the real server. Never print secrets.
    Push-Location $projectRoot
    try {
        $portValue = & $nodePath --env-file-if-exists=.env -p 'process.env.PORT || 4000'
        if ($LASTEXITCODE -ne 0) { throw '读取 .env 配置失败。' }
        $browserUrl = & $nodePath --env-file-if-exists=.env -p 'process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 4000}/`'
        if ($LASTEXITCODE -ne 0) { throw '读取访问地址配置失败。' }
    } finally { Pop-Location }
    $port = 0
    if (![int]::TryParse([string]$portValue, [ref]$port) -or $port -lt 1 -or $port -gt 65535) { throw 'PORT 必须是 1 到 65535 之间的固定端口。' }

    Set-Stage '正在结束旧项目进程…'
    if (Test-Path -LiteralPath $statePath) {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        Stop-ManagedServer $state
    }
    foreach ($ownerId in @(Get-Listener $port)) {
        $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerId"
        $health = Get-Health $port
        $entryPattern = '(?i)(?:^|[\s"''])backend[/\\]server\.js(?:[\s"'']|$)'
        $absoluteEntry = Join-Path $projectRoot 'backend\server.js'
        $absoluteWrapper = Join-Path $PSScriptRoot 'desktop-server.cjs'
        if ($existing.Name -ne 'node.exe' -or !$health -or $health.storage -ne 'sqlite-wal' -or
            (!($existing.CommandLine -match $entryPattern) -and !$existing.CommandLine.Contains($absoluteEntry) -and !$existing.CommandLine.Contains($absoluteWrapper))) {
            throw "端口 $port 被其他程序占用（PID $ownerId），已取消重启。"
        }
        # Compatibility with a server originally started in a terminal using npm start.
        # Windows cannot deliver Node SIGTERM externally; subsequent launches use the pipe above.
        Stop-Process -Id $ownerId -Force
        $oldProcess = Get-Process -Id $ownerId -ErrorAction SilentlyContinue
        if ($oldProcess -and !$oldProcess.WaitForExit(10000)) { throw '旧服务无法退出。' }
    }
    $freeDeadline = [DateTime]::UtcNow.AddSeconds(10)
    while (@(Get-Listener $port).Count -gt 0) {
        if ([DateTime]::UtcNow -gt $freeDeadline) { throw "端口 $port 未能释放。" }
        Start-Sleep -Milliseconds 250
    }

    Set-Stage '旧进程已结束，正在构建项目…'
    # Capture build errors in memory only; never create output/error log files.
    $buildInfo = New-Object System.Diagnostics.ProcessStartInfo
    $buildInfo.FileName = $nodePath
    $buildInfo.Arguments = "`"$npmCli`" run build"
    $buildInfo.WorkingDirectory = $projectRoot
    $buildInfo.UseShellExecute = $false
    $buildInfo.CreateNoWindow = $true
    $buildInfo.RedirectStandardOutput = $true
    $buildInfo.RedirectStandardError = $true
    $build = New-Object System.Diagnostics.Process
    $build.StartInfo = $buildInfo
    [void]$build.Start()
    $buildOutput = $build.StandardOutput.ReadToEndAsync()
    $buildError = $build.StandardError.ReadToEndAsync()
    if (!$build.WaitForExit(180000)) {
        & "$env:SystemRoot\System32\taskkill.exe" /PID $build.Id /T /F | Out-Null
        throw '构建超过 3 分钟，服务未启动。'
    }
    $build.WaitForExit()
    if ($build.ExitCode -ne 0) {
        $details = $buildError.GetAwaiter().GetResult().Trim()
        if (!$details) { $details = $buildOutput.GetAwaiter().GetResult().Trim() }
        if ($details.Length -gt 1600) { $details = $details.Substring($details.Length - 1600) }
        throw "构建失败（退出码 $($build.ExitCode)），服务未启动。`n$details"
    }
    $build.Dispose()

    Set-Stage '正在启动服务并等待健康检查…'
    $token = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
    $previousToken = $env:MUSEBOARD_LAUNCH_TOKEN
    $env:MUSEBOARD_LAUNCH_TOKEN = $token
    try {
        $wrapper = Join-Path $PSScriptRoot 'desktop-server.cjs'
        $startedServer = Start-Process -FilePath $nodePath -ArgumentList "--env-file-if-exists=.env `"$wrapper`"" -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
        $null = $startedServer.Handle
    } finally { $env:MUSEBOARD_LAUNCH_TOKEN = $previousToken }
    $identity = Get-CimInstance Win32_Process -Filter "ProcessId=$($startedServer.Id)"
    if (!$identity) { throw '服务启动后立即退出，请检查项目配置。' }
    $state = @{ pid = $startedServer.Id; createdAt = $identity.CreationDate.ToUniversalTime().ToString('o'); token = $token }
    $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    $ready = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        $startedServer.Refresh()
        if ($startedServer.HasExited) { throw "服务启动失败（退出码 $($startedServer.ExitCode)），请检查项目配置。" }
        $health = Get-Health $port
        if ($health -and $health.ok -eq $true -and $health.storage -eq 'sqlite-wal' -and
            @(Get-Listener $port) -contains $startedServer.Id) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (!$ready) { throw '90 秒内健康检查未通过，请检查项目配置及端口占用。' }
    Start-Sleep -Seconds 1
    $startedServer.Refresh()
    if ($startedServer.HasExited) { throw '服务意外退出，请检查项目配置。' }
    $completed = $true
    Set-Stage '服务已就绪，正在打开网页…'
    $browserMessage = '已自动打开浏览器。'
    if ($NoBrowser) { $browserMessage = '本次验证未打开浏览器。' }
    else {
        try { Start-Process $browserUrl }
        catch { $browserMessage = "浏览器未能自动打开，请手动访问：`n$browserUrl" }
    }
    Show-Notice "项目重启成功，服务健康检查已通过。`n$browserMessage"
} catch {
    $message = $_.Exception.Message
    if ($startedServer -and !$completed) {
        try { Stop-ManagedServer $state } catch { Stop-Process -Id $startedServer.Id -Force -ErrorAction SilentlyContinue }
    }
    Show-Notice "项目重启失败。`n`n$message" $true
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
