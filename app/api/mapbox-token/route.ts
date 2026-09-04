import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  const token = runtimeEnv.MAPBOX_PUBLIC_TOKEN;

  if (!token) {
    return Response.json(
      { token: null },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return Response.json(
    { token },
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
