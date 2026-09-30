using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace PhiliaInput {
    class Program {
        [DllImport("user32.dll", SetLastError = true)]
        static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

        [DllImport("user32.dll", SetLastError = true)]
        static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
        delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        const uint MOUSEEVENTF_LEFTUP = 0x0004;
        const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        const uint MOUSEEVENTF_WHEEL = 0x0800;

        const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        const uint KEYEVENTF_KEYUP = 0x0002;
        const uint KEYEVENTF_UNICODE = 0x0004;

        static void Main(string[] args) {
            if (args.Length == 0) {
                Console.WriteLine("{\"error\":\"No command specified\"}");
                return;
            }

            string cmd = args[0].ToLowerInvariant();
            try {
                switch (cmd) {
                    case "dimensions":
                        GetDimensions();
                        break;
                    case "move":
                        MoveMouse(int.Parse(args[1]), int.Parse(args[2]), args.Length > 3 && bool.Parse(args[3]));
                        break;
                    case "click":
                        ClickMouse(
                            int.Parse(args[1]),
                            int.Parse(args[2]),
                            args.Length > 3 ? args[3] : "left",
                            args.Length > 4 && bool.Parse(args[4])
                        );
                        break;
                    case "drag":
                        DragMouse(int.Parse(args[1]), int.Parse(args[2]), int.Parse(args[3]), int.Parse(args[4]));
                        break;
                    case "type-b64":
                        string text = Encoding.UTF8.GetString(Convert.FromBase64String(args[1]));
                        TypeText(text);
                        break;
                    case "hotkey":
                        SendHotkey(args[1]);
                        break;
                    case "scroll":
                        ScrollMouse(int.Parse(args[1]));
                        break;
                    case "focus-b64":
                        string target = Encoding.UTF8.GetString(Convert.FromBase64String(args[1]));
                        FocusWindow(target);
                        break;
                    default:
                        Console.WriteLine("{\"error\":\"Unknown command: " + cmd + "\"}");
                        break;
                }
            } catch (Exception ex) {
                Console.WriteLine("{\"error\":\"" + EscapeJson(ex.Message) + "\"}");
            }
        }

        static string EscapeJson(string s) {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ");
        }

        static void GetDimensions() {
            var bounds = Screen.PrimaryScreen.Bounds;
            var pos = Cursor.Position;
            Console.WriteLine(string.Format(
                "{{\"width\":{0},\"height\":{1},\"cursorX\":{2},\"cursorY\":{3}}}",
                bounds.Width, bounds.Height, pos.X, pos.Y
            ));
        }

        static void MoveMouse(int x, int y, bool smooth) {
            if (!smooth) {
                Cursor.Position = new Point(x, y);
            } else {
                Point start = Cursor.Position;
                int dx = x - start.X;
                int dy = y - start.Y;
                int dist = Math.Max(Math.Abs(dx), Math.Abs(dy));
                int steps = Math.Max(1, Math.Min(30, dist / 15));
                for (int i = 1; i <= steps; i++) {
                    int nx = start.X + (dx * i / steps);
                    int ny = start.Y + (dy * i / steps);
                    Cursor.Position = new Point(nx, ny);
                    Thread.Sleep(5);
                }
                Cursor.Position = new Point(x, y);
            }
            Console.WriteLine(string.Format("{{\"success\":true,\"action\":\"move\",\"x\":{0},\"y\":{1}}}", x, y));
        }

        static void ClickMouse(int x, int y, string button, bool doubleClick) {
            Cursor.Position = new Point(x, y);
            Thread.Sleep(25);

            uint down = MOUSEEVENTF_LEFTDOWN;
            uint up = MOUSEEVENTF_LEFTUP;

            string b = button.ToLowerInvariant();
            if (b == "right") {
                down = MOUSEEVENTF_RIGHTDOWN;
                up = MOUSEEVENTF_RIGHTUP;
            } else if (b == "middle") {
                down = MOUSEEVENTF_MIDDLEDOWN;
                up = MOUSEEVENTF_MIDDLEUP;
            }

            mouse_event(down, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(20);
            mouse_event(up, 0, 0, 0, UIntPtr.Zero);

            if (doubleClick) {
                Thread.Sleep(80);
                mouse_event(down, 0, 0, 0, UIntPtr.Zero);
                Thread.Sleep(20);
                mouse_event(up, 0, 0, 0, UIntPtr.Zero);
            }

            Console.WriteLine(string.Format(
                "{{\"success\":true,\"action\":\"click\",\"x\":{0},\"y\":{1},\"button\":\"{2}\",\"doubleClick\":{3}}}",
                x, y, button, doubleClick ? "true" : "false"
            ));
        }

        static void DragMouse(int x1, int y1, int x2, int y2) {
            Cursor.Position = new Point(x1, y1);
            Thread.Sleep(30);
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(30);

            int dx = x2 - x1;
            int dy = y2 - y1;
            int dist = Math.Max(Math.Abs(dx), Math.Abs(dy));
            int steps = Math.Max(1, Math.Min(40, dist / 10));
            for (int i = 1; i <= steps; i++) {
                int nx = x1 + (dx * i / steps);
                int ny = y1 + (dy * i / steps);
                Cursor.Position = new Point(nx, ny);
                Thread.Sleep(8);
            }
            Cursor.Position = new Point(x2, y2);
            Thread.Sleep(30);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);

            Console.WriteLine(string.Format(
                "{{\"success\":true,\"action\":\"drag\",\"startX\":{0},\"startY\":{1},\"endX\":{2},\"endY\":{3}}}",
                x1, y1, x2, y2
            ));
        }

        static void TypeText(string text) {
            foreach (char c in text) {
                if (c == '\r') continue;
                if (c == '\n') {
                    keybd_event(0x0D, 0, 0, UIntPtr.Zero);
                    Thread.Sleep(10);
                    keybd_event(0x0D, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                } else if (c == '\t') {
                    keybd_event(0x09, 0, 0, UIntPtr.Zero);
                    Thread.Sleep(10);
                    keybd_event(0x09, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                } else {
                    keybd_event(0, (byte)c, KEYEVENTF_UNICODE, UIntPtr.Zero);
                    Thread.Sleep(6);
                    keybd_event(0, (byte)c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, UIntPtr.Zero);
                }
                Thread.Sleep(8);
            }
            Console.WriteLine(string.Format("{{\"success\":true,\"action\":\"type\",\"charCount\":{0}}}", text.Length));
        }

        static void SendHotkey(string hotkey) {
            string[] parts = hotkey.Split('+');
            List<byte> pressed = new List<byte>();

            foreach (var part in parts) {
                string p = part.Trim().ToLowerInvariant();
                byte vk = ParseVk(p);
                if (vk != 0) {
                    keybd_event(vk, 0, 0, UIntPtr.Zero);
                    pressed.Add(vk);
                    Thread.Sleep(15);
                }
            }

            Thread.Sleep(30);

            // Release in reverse order
            for (int i = pressed.Count - 1; i >= 0; i--) {
                keybd_event(pressed[i], 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                Thread.Sleep(10);
            }

            Console.WriteLine(string.Format("{{\"success\":true,\"action\":\"hotkey\",\"keys\":\"{0}\"}}", EscapeJson(hotkey)));
        }

        static byte ParseVk(string key) {
            switch (key) {
                case "ctrl": case "control": return 0x11;
                case "alt": return 0x12;
                case "shift": return 0x10;
                case "win": case "windows": case "cmd": case "super": return 0x5B;
                case "enter": case "return": return 0x0D;
                case "tab": return 0x09;
                case "esc": case "escape": return 0x1B;
                case "space": return 0x20;
                case "backspace": return 0x08;
                case "delete": case "del": return 0x2E;
                case "up": return 0x26;
                case "down": return 0x28;
                case "left": return 0x25;
                case "right": return 0x27;
                case "home": return 0x24;
                case "end": return 0x23;
                case "pageup": return 0x21;
                case "pagedown": return 0x22;
                case "f1": return 0x70;
                case "f2": return 0x71;
                case "f3": return 0x72;
                case "f4": return 0x73;
                case "f5": return 0x74;
                case "f6": return 0x75;
                case "f7": return 0x76;
                case "f8": return 0x77;
                case "f9": return 0x78;
                case "f10": return 0x79;
                case "f11": return 0x7A;
                case "f12": return 0x7B;
                default:
                    if (key.Length == 1) {
                        char c = char.ToUpperInvariant(key[0]);
                        if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
                            return (byte)c;
                        }
                    }
                    return 0;
            }
        }

        static void ScrollMouse(int delta) {
            mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)delta, UIntPtr.Zero);
            Console.WriteLine(string.Format("{{\"success\":true,\"action\":\"scroll\",\"delta\":{0}}}", delta));
        }

        static void FocusWindow(string target) {
            string query = target.ToLowerInvariant();
            IntPtr matchedHwnd = IntPtr.Zero;
            string matchedTitle = "";

            Process[] procs = Process.GetProcesses();
            foreach (var p in procs) {
                try {
                    if (p.MainWindowHandle != IntPtr.Zero) {
                        string pName = p.ProcessName.ToLowerInvariant();
                        string pTitle = p.MainWindowTitle.ToLowerInvariant();
                        if (pName.Contains(query) || pTitle.Contains(query)) {
                            matchedHwnd = p.MainWindowHandle;
                            matchedTitle = p.MainWindowTitle.Length > 0 ? p.MainWindowTitle : p.ProcessName;
                            break;
                        }
                    }
                } catch {}
            }

            if (matchedHwnd == IntPtr.Zero) {
                EnumWindows((hWnd, lParam) => {
                    var sb = new StringBuilder(256);
                    if (GetWindowText(hWnd, sb, 256) > 0) {
                        string title = sb.ToString().ToLowerInvariant();
                        if (title.Contains(query)) {
                            matchedHwnd = hWnd;
                            matchedTitle = sb.ToString();
                            return false;
                        }
                    }
                    return true;
                }, IntPtr.Zero);
            }

            if (matchedHwnd != IntPtr.Zero) {
                ShowWindow(matchedHwnd, 9); // SW_RESTORE
                SetForegroundWindow(matchedHwnd);
                Console.WriteLine(string.Format(
                    "{{\"success\":true,\"action\":\"focus\",\"title\":\"{0}\"}}",
                    EscapeJson(matchedTitle)
                ));
            } else {
                Console.WriteLine(string.Format(
                    "{{\"success\":false,\"action\":\"focus\",\"message\":\"No window found matching: {0}\"}}",
                    EscapeJson(target)
                ));
            }
        }
    }
}
