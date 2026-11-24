param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Title = '文档1 - Word',
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Word" WindowStyle="None" ResizeMode="NoResize" Topmost="True"
        ShowInTaskbar="False" Background="White" Width="640" Height="97.5"
        WindowStartupLocation="Manual" AllowsTransparency="False">
  <Window.Resources>
    <Style TargetType="{x:Type ScrollBar}">
      <Setter Property="Width" Value="8" />
      <Setter Property="MinWidth" Value="8" />
      <Setter Property="Background" Value="Transparent" />
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="{x:Type ScrollBar}">
            <Grid Background="Transparent">
              <Track x:Name="PART_Track" IsDirectionReversed="True"
                     Minimum="{TemplateBinding Minimum}" Maximum="{TemplateBinding Maximum}"
                     Value="{TemplateBinding Value}" ViewportSize="{TemplateBinding ViewportSize}">
                <Track.DecreaseRepeatButton>
                  <RepeatButton Command="ScrollBar.PageUpCommand" Opacity="0" />
                </Track.DecreaseRepeatButton>
                <Track.Thumb>
                  <Thumb Width="6" MinHeight="24">
                    <Thumb.Template>
                      <ControlTemplate TargetType="{x:Type Thumb}">
                        <Border Background="#C9C9C9" CornerRadius="3" Margin="1,0" />
                      </ControlTemplate>
                    </Thumb.Template>
                  </Thumb>
                </Track.Thumb>
                <Track.IncreaseRepeatButton>
                  <RepeatButton Command="ScrollBar.PageDownCommand" Opacity="0" />
                </Track.IncreaseRepeatButton>
              </Track>
            </Grid>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>
  <Grid>
    <TextBox x:Name="Box" Margin="0" Padding="20,14,24,10" BorderThickness="0"
             Background="White" Foreground="#111111"
             FontFamily="FangSong, 仿宋, FangSong_GB2312, SimSun"
             FontSize="21.33" TextWrapping="Wrap" AcceptsReturn="True"
             VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled"
             SpellCheck.IsEnabled="False" />
    <Button x:Name="CloseButton" Content="×" Width="26" Height="26"
            HorizontalAlignment="Right" VerticalAlignment="Top" Margin="0,8,10,0"
            Background="Transparent" BorderThickness="0" Foreground="#888888"
            FontSize="17" Cursor="Hand" IsTabStop="False" />
    <Border x:Name="DragBar" Height="12" VerticalAlignment="Top"
            Background="#01FFFFFF" />
  </Grid>
</Window>
'@

$doc = New-Object System.Xml.XmlDocument
$doc.LoadXml($xaml)
$reader = New-Object System.Xml.XmlNodeReader $doc
$win = [Windows.Markup.XamlReader]::Load($reader)
$box = $win.FindName('Box')
$close = $win.FindName('CloseButton')
$drag = $win.FindName('DragBar')

$utf8 = New-Object System.Text.UTF8Encoding($false)
$box.Text = [IO.File]::ReadAllText($In, $utf8)
if ($Title) { $win.Title = $Title }

if ($SelfTest) {
  [IO.File]::WriteAllText($Out, $box.Text, $utf8)
  exit 0
}

$area = [System.Windows.SystemParameters]::WorkArea
# A4 is 210mm (794 DIP); the writer asked for something a little narrower.
$win.Width = [Math]::Min(640, [Math]::Max(480, $area.Width - 40))
$win.Left = [Math]::Round($area.Left + ($area.Width - $win.Width) / 2)
$win.Top = [Math]::Round($area.Bottom - $win.Height - 40)

$save = {
  try { [IO.File]::WriteAllText($Out, $box.Text, $utf8) } catch { }
}
$script:last = $box.Text
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(700)
$timer.Add_Tick({
  if ($box.Text -ne $script:last) {
    $script:last = $box.Text
    & $save
  }
})
$timer.Start()

$win.Add_Closing({ & $save })
$close.Add_Click({ $win.Close() })
$box.Add_PreviewKeyDown({
  param($sender, $e)
  if ($e.Key -eq [System.Windows.Input.Key]::Escape) {
    $e.Handled = $true
    $win.Close()
  }
})
$drag.Add_MouseLeftButtonDown({ $win.DragMove() })

$win.ShowDialog() | Out-Null
