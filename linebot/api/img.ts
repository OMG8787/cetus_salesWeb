import { DRIVE_ID, IMG_MAX_W, IMG_MIN_W } from "../src/img.js";

/** 知識庫圖片代理：GET /api/img?id=雲端硬碟檔案代號&w=寬度（LINE 與網站視窗都用這個網址顯示圖片） */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const w = Math.min(IMG_MAX_W, Math.max(IMG_MIN_W, Math.round(Number(url.searchParams.get("w")) || 1280)));
  if (!DRIVE_ID.test(id)) return new Response("bad id", { status: 400 });
  try {
    // 不帶 webp：LINE 只收 JPG / PNG
    const upstream = await fetch(`https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w${w}`, { headers: { Accept: "image/jpeg,image/png;q=0.9" }, redirect: "follow" });
    const type = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !type.startsWith("image/")) return new Response("not found", { status: 404 });
    const bytes = await upstream.arrayBuffer();
    return new Response(bytes, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.warn("圖片代理失敗", (error as Error).message);
    return new Response("error", { status: 502 });
  }
}
