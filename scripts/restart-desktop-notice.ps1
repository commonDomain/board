function Show-RestartNotice([string]$Message, [bool]$Failed = $false) {
    if ($Failed) {
        $shell = New-Object -ComObject WScript.Shell
        [void]$shell.Popup($Message, 0, 'Museboard 项目重启', 4112)
        return
    }

    Add-Type -AssemblyName PresentationFramework
    $noticeWindow = New-Object Windows.Window
    $noticeWindow.Title = 'Museboard 项目重启'
    $noticeWindow.Width = 430
    $noticeWindow.SizeToContent = [Windows.SizeToContent]::Height
    $noticeWindow.WindowStartupLocation = [Windows.WindowStartupLocation]::CenterScreen
    $noticeWindow.ResizeMode = [Windows.ResizeMode]::NoResize
    $noticeWindow.Topmost = $true
    $noticeWindow.Background = [Windows.Media.BrushConverter]::new().ConvertFromString('#F7F9FC')

    $panel = New-Object Windows.Controls.StackPanel
    $panel.Margin = [Windows.Thickness]::new(28, 22, 28, 22)
    $text = New-Object Windows.Controls.TextBlock
    $text.Text = $Message
    $text.FontSize = 14
    $text.TextWrapping = [Windows.TextWrapping]::Wrap
    $text.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString('#172033')
    [void]$panel.Children.Add($text)
    $confirm = New-Object Windows.Controls.Button
    $confirm.Content = '确定'
    $confirm.Width = 80
    $confirm.Height = 30
    $confirm.Margin = [Windows.Thickness]::new(0, 20, 0, 0)
    $confirm.HorizontalAlignment = [Windows.HorizontalAlignment]::Right
    $confirm.IsDefault = $true
    $confirm.IsCancel = $true
    $confirm.Add_Click({ $noticeWindow.Close() })
    [void]$panel.Children.Add($confirm)
    $noticeWindow.Content = $panel

    $closeTimer = New-Object Windows.Threading.DispatcherTimer
    $closeTimer.Interval = [TimeSpan]::FromSeconds(3)
    $closeTimer.Add_Tick({
        $closeTimer.Stop()
        $noticeWindow.Close()
    })
    $noticeWindow.Add_ContentRendered({ $closeTimer.Start() })
    try { [void]$noticeWindow.ShowDialog() }
    finally { $closeTimer.Stop() }
}
