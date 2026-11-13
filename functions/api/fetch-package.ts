/**
 * Cloudflare Pages entry for the "Open from URL" fallback proxy.
 * The proxy itself lives in api/fetch-package.ts (shared with the Vercel deployment);
 * this file only hands Pages' request to it, so both hosts run the same code.
 */
import { GET } from "../../api/fetch-package";

export const onRequestGet = ({ request }: { request: Request }): Promise<Response> => GET(request);
