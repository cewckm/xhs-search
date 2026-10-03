param([string]$op = 'rect', [int]$wpid = 0, [int]$x = 0, [int]$y = 0, [int]$x0 = 0, [int]$y0 = 0, [int]$steps = 6)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class U32 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(70);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(55);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }
  public static void Glide(int x0, int y0, int x1, int y1, int n) {
    for (int i = 1; i <= n; i++) {
      SetCursorPos(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
      System.Threading.Thread.Sleep(12);
    }
  }
}
"@

# Resolve a candidate window: the given PID's window, else any visible non-minimized msedge window.
function Resolve-Window {
  if ($wpid -gt 0) {
    $p = Get-Process -Id $wpid -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne 0) { return $p }
  }
  $cands = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
  foreach ($c in $cands) {
    $r = New-Object U32+RECT
    [void][U32]::GetWindowRect($c.MainWindowHandle, [ref]$r)
    # skip minimized/off-screen windows (they sit at -32000)
    if ($r.Left -gt -10000 -and $r.Top -gt -10000 -and ($r.Right - $r.Left) -gt 200) { return $c }
  }
  return $null
}

switch ($op) {
  'rect' {
    $p = Resolve-Window
    if (-not $p) { 'none'; break }
    $r = New-Object U32+RECT
    [void][U32]::GetWindowRect($p.MainWindowHandle, [ref]$r)
    "$($p.Id)|$($r.Left)|$($r.Top)|$($r.Right)|$($r.Bottom)|$($p.MainWindowTitle)"
  }
  'focus' {
    $p = Resolve-Window
    if (-not $p) { 'none'; break }
    if ([U32]::IsIconic($p.MainWindowHandle)) { [void][U32]::ShowWindow($p.MainWindowHandle, 9) }
    [void][U32]::SetForegroundWindow($p.MainWindowHandle)
    Start-Sleep -Milliseconds 450
    'ok'
  }
  'click' { [U32]::Click($x, $y); 'ok' }
  'glideclick' { [U32]::Glide($x0, $y0, $x, $y, $steps); Start-Sleep -Milliseconds 90; [U32]::Click($x, $y); 'ok' }
  'move' { [void][U32]::SetCursorPos($x, $y); 'ok' }
  default { 'unknown-op' }
}
