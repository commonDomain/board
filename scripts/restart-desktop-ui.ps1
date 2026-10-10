# Visible progress window; all build/server processes still run without a terminal.
$ErrorActionPreference = 'Stop'
$window = $null
$worker = $null
$timer = $null
$uiMutex = New-Object System.Threading.Mutex($false, 'Local\MuseboardDesktopWindow')
$uiLocked = $false
$statusFile = $null
$resultFile = $null
try {
    try { $uiLocked = $uiMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $uiLocked = $true }
    # Lock before creating a window, and keep it until the result dialog is dismissed.
    if (!$uiLocked) { exit 0 }
    Add-Type -AssemblyName PresentationFramework
    $runtimeDir = Join-Path $env:LOCALAPPDATA 'Museboard\launcher'
    [void](New-Item -ItemType Directory -Path $runtimeDir -Force)
    $runId = [Guid]::NewGuid().ToString('N')
    $statusFile = Join-Path $runtimeDir "ui-$runId.status"
    $resultFile = Join-Path $runtimeDir "ui-$runId.json"
    [xml]$markup = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Museboard 项目重启" Width="430" Height="218"
        WindowStartupLocation="CenterScreen" ResizeMode="NoResize"
        Background="#F7F9FC" Topmost="True">
  <Grid Margin="28,22">
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto"/><RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/><RowDefinition Height="Auto"/>
    </Grid.RowDefinitions>
    <TextBlock FontSize="21" FontWeight="SemiBold" Foreground="#172033" Text="正在重启 Museboard"/>
    <TextBlock x:Name="Stage" Grid.Row="1" Margin="0,14,0,16" FontSize="14" Foreground="#475569" Text="正在准备，请稍候…"/>
    <ProgressBar Grid.Row="2" Height="7" IsIndeterminate="True" Foreground="#3974ED" Background="#E1E8F4" BorderThickness="0"/>
    <TextBlock Grid.Row="3" Margin="0,14,0,0" FontSize="12" Foreground="#64748B" Text="完成后将提示结果，并自动打开网页。"/>
  </Grid>
</Window>
'@
    $window = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader($markup)))
    $stage = $window.FindName('Stage')
    $iconPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'public\favicon.ico'
    if (Test-Path -LiteralPath $iconPath) { $window.Icon = [Windows.Media.Imaging.BitmapFrame]::Create([Uri]$iconPath) }

    $workerPath = Join-Path $PSScriptRoot 'restart-desktop.ps1'
    $powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$workerPath`" -NoUI -StatusFile `"$statusFile`" -ResultFile `"$resultFile`""
    $worker = Start-Process -FilePath $powershellPath -ArgumentList $arguments -WindowStyle Hidden -PassThru
    $null = $worker.Handle
    $script:allowClose = $false
    $window.Add_Closing({ param($sender, $eventArgs) if (!$script:allowClose) { $eventArgs.Cancel = $true } })
    $timer = New-Object Windows.Threading.DispatcherTimer
    $timer.Interval = [TimeSpan]::FromMilliseconds(200)
    $timer.Add_Tick({
        if (Test-Path -LiteralPath $statusFile) {
            try { $stage.Text = [IO.File]::ReadAllText($statusFile, [Text.Encoding]::UTF8).Trim() } catch {}
        }
        $worker.Refresh()
        if ($worker.HasExited) {
            $timer.Stop()
            $script:allowClose = $true
            $window.Close()
        }
    })
    $timer.Start()
    [void]$window.ShowDialog()
    if (Test-Path -LiteralPath $resultFile) {
        $result = Get-Content -LiteralPath $resultFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($result.ignored) { exit 0 }
        $notice = $result.message
        $failed = $result.failed
    } else {
        $notice = "重启程序异常退出（退出码 $($worker.ExitCode)），请重新尝试。"
        $failed = $true
    }
    # These files are live UI messages, not logs; delete them before the result popup.
    Remove-Item -LiteralPath $statusFile,$resultFile -Force -ErrorAction SilentlyContinue
    $shell = New-Object -ComObject WScript.Shell
    $icon = if ($failed) { 16 } else { 64 }
    [void]$shell.Popup($notice, 0, 'Museboard 项目重启', ($icon + 4096))
} catch {
    if ($timer) { $timer.Stop() }
    if ($window) { $script:allowClose = $true; $window.Close() }
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.Popup("无法显示重启窗口或启动重启程序：`n$($_.Exception.Message)", 0, 'Museboard 项目重启失败', 4112)
} finally {
    foreach ($temporaryFile in @($statusFile,$resultFile)) {
        if ($temporaryFile) { Remove-Item -LiteralPath $temporaryFile -Force -ErrorAction SilentlyContinue }
    }
    if ($uiLocked) { $uiMutex.ReleaseMutex() }
    $uiMutex.Dispose()
}
