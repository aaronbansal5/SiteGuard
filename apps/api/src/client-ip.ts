import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";

/**
 * Rate-limit key for a client address. IPv4 (including IPv4-mapped IPv6) keys
 * by address; IPv6 keys by its /64 prefix, because a single host commonly
 * controls a whole /64 and could otherwise mint unlimited quota keys (and fill
 * the bounded limiter table, locking out everyone else).
 */
export function rateLimitKey(ip: string): string {
  const address = ip.split("%")[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) return mapped[1];
  if (isIP(address) !== 6) return address;
  const [head, tail] = address.includes("::")
    ? address.split("::")
    : [address, undefined];
  const groups = (part: string | undefined) =>
    part
      ? part.split(":").flatMap((g) => (g.includes(".") ? ["0", "0"] : [g]))
      : [];
  const h = groups(head),
    t = groups(tail);
  const full =
    tail === undefined
      ? h
      : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  return (
    full
      .slice(0, 4)
      .map((g) => parseInt(g, 16).toString(16))
      .join(":") + "::/64"
  );
}

/**
 * Client address for quotas. When the deployment names a header that its
 * reverse proxy sets authoritatively (CLIENT_IP_HEADER, e.g. fly-client-ip),
 * use it when it holds a valid IP; otherwise use the socket address.
 */
export function clientAddress(req: FastifyRequest, header?: string): string {
  if (header) {
    const value = req.headers[header];
    if (typeof value === "string" && isIP(value.trim())) return value.trim();
  }
  return req.ip;
}
