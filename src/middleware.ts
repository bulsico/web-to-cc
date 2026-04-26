import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

const PASSWORD = process.env.CC_PASSWORD || "";

function checkPassword(candidate: string): boolean {
  if (!PASSWORD) return true;
  try {
    const a = Buffer.from(candidate, "utf-8");
    const b = Buffer.from(PASSWORD, "utf-8");
    if (a.length !== b.length) {
      // Still run a comparison against itself to avoid length-based timing leak.
      timingSafeEqual(b, b);
      return false;
    }
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  if (!PASSWORD) return NextResponse.next();

  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Basic ")) {
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
    // Accept any username; only the password is checked.
    const password = decoded.includes(":") ? decoded.split(":").slice(1).join(":") : decoded;
    if (checkPassword(password)) return NextResponse.next();
  }

  return new NextResponse("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Claude Code"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
