/* Copyright (C) 2026 Christian Lockley — GPL-3.0-or-later */

using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

internal static class Program
{
    private const uint BiggerSizeOk = 0x1;
    private const uint ThumbnailOnly = 0x8;
    private const int PixelFormat32bppPArgb = 0x000E2000;
    private static readonly Guid ImageFactoryIid = new("BCC18B79-BA16-442F-80C4-8A59C30C463B");
    private static readonly Guid PngEncoderClsid = new("557CF406-1A04-11D3-9A73-0000F81EF32E");

    [STAThread]
    private static void Main()
    {
        GdipStartupInput input = new() { GdiplusVersion = 1 };
        int status = GdiplusStartup(out nuint gdipToken, ref input, IntPtr.Zero);
        if (status != 0) gdipToken = 0;
        try
        {
            string? line;
            while ((line = Console.ReadLine()) is not null)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                Console.WriteLine(HandleLine(line, gdipToken != 0));
                Console.Out.Flush();
            }
        }
        finally
        {
            if (gdipToken != 0) GdiplusShutdown(gdipToken);
        }
    }

    private static string HandleLine(string line, bool gdipReady)
    {
        JsonNode? id = null;
        try
        {
            JsonNode? request = JsonNode.Parse(line);
            id = request?["id"]?.DeepClone();
            if (request is not JsonObject obj || obj["jsonrpc"]?.GetValue<string>() != "2.0" ||
                obj["method"] is not JsonValue methodNode || !methodNode.TryGetValue(out string? method))
                return RpcError(id, -32600, "Invalid Request");
            if (method == "poster.ready")
                return RpcResult(id, new JsonObject {
                    ["ready"] = gdipReady,
                    ["provider"] = "windows-shell",
                    ["providerVersion"] = Environment.OSVersion.VersionString,
                });
            if (method != "poster.generate")
                return RpcError(id, -32601, "Method not found");

            JsonNode? options = obj["params"] is JsonArray array ? array.FirstOrDefault() : obj["params"];
            string? path = options?["path"]?.GetValue<string>();
            int size = options?["size"]?.GetValue<int>() ?? 512;
            if (string.IsNullOrWhiteSpace(path))
                return RpcError(id, -32602, "Invalid params");
            return RpcResult(id, Generate(path, size, gdipReady));
        }
        catch (JsonException)
        {
            return RpcError(null, -32700, "Parse error");
        }
        catch (Exception ex)
        {
            return RpcResult(id, Failure("internal_error", ex.Message));
        }
    }

    private static JsonObject Generate(string inputPath, int requestedSize, bool gdipReady)
    {
        if (!gdipReady) return Failure("encoder_unavailable", "Windows GDI+ could not be initialized");
        string path;
        try { path = Path.GetFullPath(inputPath); }
        catch (Exception ex) { return Failure("invalid_request", ex.Message); }
        if (!File.Exists(path)) return Failure("not_found", "Video file does not exist");

        int size = Math.Clamp(requestedSize, 64, 1024);
        DateTime modified = File.GetLastWriteTimeUtc(path);
        long mtime = new DateTimeOffset(modified).ToUnixTimeMilliseconds();
        string cacheRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "EMS Media System", "thumbnails");
        Directory.CreateDirectory(cacheRoot);
        string cacheKey = Convert.ToHexString(SHA256.HashData(
            Encoding.UTF8.GetBytes($"{path.ToUpperInvariant()}|{modified.Ticks}|{size}"))).ToLowerInvariant();
        string output = Path.Combine(cacheRoot, cacheKey + ".png");
        if (File.Exists(output)) return Success(output, mtime, true);

        IShellItemImageFactory? factory = null;
        IntPtr bitmap = IntPtr.Zero;
        IntPtr image = IntPtr.Zero;
        string temporary = output + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            Guid iid = ImageFactoryIid;
            int hr = SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out factory);
            Marshal.ThrowExceptionForHR(hr);
            hr = factory.GetImage(new NativeSize(size, size), ThumbnailOnly | BiggerSizeOk, out bitmap);
            Marshal.ThrowExceptionForHR(hr);
            int status = CreateGdipImageFromHbitmap(bitmap, out image);
            if (status != 0) throw new InvalidOperationException($"GDI+ could not import the Shell bitmap ({status})");
            Guid png = PngEncoderClsid;
            status = GdipSaveImageToFile(image, temporary, ref png, IntPtr.Zero);
            if (status != 0) throw new InvalidOperationException($"GDI+ could not save the poster ({status})");
            File.Move(temporary, output, true);
            return Success(output, mtime, false);
        }
        catch (COMException ex)
        {
            return Failure("unsupported", $"Windows Shell thumbnail provider failed (0x{ex.HResult:X8})");
        }
        catch (Exception ex)
        {
            return Failure("generation_failed", ex.Message);
        }
        finally
        {
            if (image != IntPtr.Zero) GdipDisposeImage(image);
            if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
            if (factory is not null) Marshal.FinalReleaseComObject(factory);
            try { if (File.Exists(temporary)) File.Delete(temporary); } catch { }
        }
    }

    private static int CreateGdipImageFromHbitmap(IntPtr hbitmap, out IntPtr image)
    {
        int status = GdipCreateBitmapFromHBITMAP(hbitmap, IntPtr.Zero, out image);
        if (status == 0 && image != IntPtr.Zero) return 0;
        if (image != IntPtr.Zero)
        {
            GdipDisposeImage(image);
            image = IntPtr.Zero;
        }

        if (GetObject(hbitmap, Marshal.SizeOf<NativeBitmap>(), out NativeBitmap bitmap) == 0)
            return status == 0 ? 2 : status;
        int width = bitmap.Width;
        int height = Math.Abs(bitmap.Height);
        if (width <= 0 || height <= 0) return 2;

        BitmapInfo info = new()
        {
            Header = new BitmapInfoHeader
            {
                Size = Marshal.SizeOf<BitmapInfoHeader>(),
                Width = width,
                Height = -height,
                Planes = 1,
                BitCount = 32,
                Compression = 0,
            },
        };
        int stride = width * 4;
        IntPtr bits = Marshal.AllocHGlobal(stride * height);
        try
        {
            IntPtr hdc = GetDC(IntPtr.Zero);
            if (hdc == IntPtr.Zero) return 2;
            int copied;
            try { copied = GetDIBits(hdc, hbitmap, 0, (uint)height, bits, ref info, 0); }
            finally { _ = ReleaseDC(IntPtr.Zero, hdc); }
            if (copied == 0) return 2;

            status = GdipCreateBitmapFromScan0(width, height, stride, PixelFormat32bppPArgb, bits, out IntPtr owned);
            if (status != 0 || owned == IntPtr.Zero) return status == 0 ? 2 : status;
            try
            {
                status = GdipCloneImage(owned, out image);
                if (status != 0) image = IntPtr.Zero;
                return status;
            }
            finally { GdipDisposeImage(owned); }
        }
        finally { Marshal.FreeHGlobal(bits); }
    }

    private static JsonObject Success(string output, long mtime, bool cached) => new()
    {
        ["ok"] = true,
        ["cached"] = cached,
        ["output"] = output,
        ["mtime"] = mtime,
        ["provider"] = "windows-shell",
        ["providerVersion"] = Environment.OSVersion.VersionString,
    };
    private static JsonObject Failure(string code, string message) => new()
    {
        ["ok"] = false,
        ["code"] = code,
        ["message"] = message,
        ["provider"] = "windows-shell",
    };
    private static string RpcResult(JsonNode? id, JsonNode value) => new JsonObject
    {
        ["jsonrpc"] = "2.0",
        ["id"] = id?.DeepClone(),
        ["result"] = value,
    }.ToJsonString();
    private static string RpcError(JsonNode? id, int code, string message) => new JsonObject
    {
        ["jsonrpc"] = "2.0",
        ["id"] = id?.DeepClone(),
        ["error"] = new JsonObject { ["code"] = code, ["message"] = message },
    }.ToJsonString();

    [StructLayout(LayoutKind.Sequential)]
    private readonly struct NativeSize(int width, int height)
    {
        public readonly int Width = width;
        public readonly int Height = height;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeBitmap
    {
        public int Type;
        public int Width;
        public int Height;
        public int WidthBytes;
        public ushort Planes;
        public ushort BitsPixel;
        public IntPtr Bits;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BitmapInfoHeader
    {
        public int Size;
        public int Width;
        public int Height;
        public ushort Planes;
        public ushort BitCount;
        public int Compression;
        public int SizeImage;
        public int XPelsPerMeter;
        public int YPelsPerMeter;
        public int ClrUsed;
        public int ClrImportant;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BitmapInfo
    {
        public BitmapInfoHeader Header;
        public uint RedMask;
        public uint GreenMask;
        public uint BlueMask;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct GdipStartupInput
    {
        public uint GdiplusVersion;
        public IntPtr DebugEventCallback;
        [MarshalAs(UnmanagedType.Bool)] public bool SuppressBackgroundThread;
        [MarshalAs(UnmanagedType.Bool)] public bool SuppressExternalCodecs;
    }

    [ComImport, Guid("BCC18B79-BA16-442F-80C4-8A59C30C463B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory
    {
        [PreserveSig] int GetImage(NativeSize size, uint flags, out IntPtr bitmap);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHCreateItemFromParsingName(string path, IntPtr bindContext, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory factory);
    [DllImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DeleteObject(IntPtr handle);
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] private static extern int GetObject(IntPtr handle, int count, out NativeBitmap bitmap);
    [DllImport("gdi32.dll")] private static extern int GetDIBits(IntPtr hdc, IntPtr bitmap, uint start, uint lines, IntPtr bits, ref BitmapInfo info, uint usage);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
    [DllImport("gdiplus.dll")] private static extern int GdiplusStartup(out nuint token, ref GdipStartupInput input, IntPtr output);
    [DllImport("gdiplus.dll")] private static extern void GdiplusShutdown(nuint token);
    [DllImport("gdiplus.dll")] private static extern int GdipCreateBitmapFromHBITMAP(IntPtr bitmap, IntPtr palette, out IntPtr image);
    [DllImport("gdiplus.dll")] private static extern int GdipCreateBitmapFromScan0(int width, int height, int stride, int format, IntPtr scan0, out IntPtr bitmap);
    [DllImport("gdiplus.dll")] private static extern int GdipCloneImage(IntPtr image, out IntPtr cloneImage);
    [DllImport("gdiplus.dll", CharSet = CharSet.Unicode)] private static extern int GdipSaveImageToFile(IntPtr image, string filename, ref Guid clsidEncoder, IntPtr encoderParameters);
    [DllImport("gdiplus.dll")] private static extern int GdipDisposeImage(IntPtr image);
}
