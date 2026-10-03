// osclick.mjs — genuine OS-level mouse input via SendInput/mouse_event in PowerShell.
// Calibrates the window's viewport origin so viewport coordinates map to real screen pixels.
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from './config.mjs';

const PS = join(CONFIG.scriptsDir, 'osclick.ps1');
const CAL = CONFIG.calibration;

const PS_CODE = `
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
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  const uint DOWN = 0x0002, UP = 0x0004;
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(70);
    mouse_event(DOWN, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(55);
    mouse_event(UP, 0, 0, 0, UIntPtr.Zero);
  }
  public static void Glide(int x0, int y0, int x1, int y1, int n) {
    for (int i = 1; i <= n; i++) {
      SetCursorPos(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
      System.Threading.Thread.Sleep(12);
    }
  }
}
"@
param([string]$op, [int]$x = 0, [int]$y = 0, [int]$x0 = 0, [int]$y0 = 0, [int]$steps = 6)
function Get-XhsWindow {
  $p = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*REDLAND*' -or $_.MainWindowTitle -like '*RED*' -or $_.MainWindowTitle -like '*小红书*' -or $_.MainWindowTitle -like '*小红书*' } | Select-Object -First 1
  if (-not $p) { $p = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1 }
  return $p
}
switch ($op) {
  'rect' {
    $p = Get-XhsWindow
    if (-not $p) { 'none'; break }
    $r = New-Object U32+RECT
    [void][U32]::GetWindowRect($p.MainWindowHandle, [ref]$r)
    "$($p.Id)|$($r.Left)|$($r.Top)|$($r.Right)|$($r.Bottom)"
  }
  'focus' {
    $p = Get-XhsWindow
    if (-not $p) { 'none'; break }
    if ([U32]::IsIconic($p.MainWindowHandle)) { [void][U32]::ShowWindow($p.MainWindowHandle, 9) }
    [void][U32]::SetForegroundWindow($p.MainWindowHandle)
    Start-Sleep -Milliseconds 350
    'ok'
  }
  'click' { [U32]::Click($x, $y); 'ok' }
  'glideclick' { [U32]::Glide($x0, $y0, $x, $y, $steps); Start-Sleep -Milliseconds 90; [U32]::Click($x, $y); 'ok' }
  'move' { [void][U32]::SetCursorPos($x, $y); 'ok' }
  default { 'unknown-op' }
}
`;

if (!existsSync(PS)) writeFileSync(PS, '\uFEFF' + PS_CODE, 'utf8');

function ps(op, args = []) {
  const out = execFileSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS, '-op', op, ...args],
    { encoding: 'utf8', timeout: 40000 });
  return out.trim();
}

/** The browser's OS pid, straight from the DevTools endpoint. */
export async function browserPid() {
  const v = await (await fetch('http://127.0.0.1:9222/json/version')).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const info = await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('timeout')), 10000);
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === 1) { clearTimeout(to); resolve(m.result); }
    });
    ws.send(JSON.stringify({ id: 1, method: 'SystemInfo.getProcessInfo' }));
  });
  ws.close();
  const b = (info.processInfo || []).find((p) => p.type === 'browser');
  return b ? b.id : null;
}

export function windowRect(pid) {
  const out = ps('rect', pid ? ['-wpid', String(pid)] : []);
  if (out === 'none' || !out.includes('|')) return null;
  const [wpid, left, top, right, bottom] = out.split('|').map(Number);
  return { pid: wpid, left, top, right, bottom, width: right - left, height: bottom - top };
}

export function focusWindow(pid) { return ps('focus', pid ? ['-wpid', String(pid)] : []); }

export function loadCalibration() {
  if (!existsSync(CAL)) return null;
  try { return JSON.parse(readFileSync(CAL, 'utf8')); } catch { return null; }
}
export function saveCalibration(obj) { writeFileSync(CAL, JSON.stringify(obj, null, 1), 'utf8'); }

/** Click at viewport coordinates using calibrated offsets. */
export function osClick(vx, vy, origin) {
  const x = Math.round(origin.left + vx);
  const y = Math.round(origin.top + vy);
  ps('click', ['-x', String(x), '-y', String(y)]);
  return { x, y };
}

/** Move the real cursor along a path then click (looks less robotic). */
export function osGlideClick(vx, vy, origin, from) {
  const x = Math.round(origin.left + vx);
  const y = Math.round(origin.top + vy);
  const x0 = Math.round(origin.left + (from?.x ?? vx));
  const y0 = Math.round(origin.top + (from?.y ?? vy));
  ps('glideclick', ['-x', String(x), '-y', String(y), '-x0', String(x0), '-y0', String(y0), '-steps', '6']);
  return { x, y };
}

export function moveMouse(vx, vy, origin) {
  return ps('move', ['-x', String(Math.round(origin.left + vx)), '-y', String(Math.round(origin.top + vy))]);
}
