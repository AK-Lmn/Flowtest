import net from "net";
import dns from "dns";

/**
 * Checks if an IP address is private, loopback, link-local, multicast, or reserved.
 */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return true;

    // RFC 1918 Private Ranges
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;

    // Loopback (127.0.0.0/8)
    if (parts[0] === 127) return true;

    // Link-local (169.254.0.0/16)
    if (parts[0] === 169 && parts[1] === 254) return true;

    // Unspecified (0.0.0.0/8)
    if (parts[0] === 0) return true;

    // Multicast (224.0.0.0/4)
    if (parts[0] >= 224 && parts[0] <= 239) return true;

    // Reserved/Experimental (240.0.0.0/4)
    if (parts[0] >= 240) return true;

    return false;
  }

  if (net.isIPv6(ip)) {
    const cleanIp = ip.toLowerCase().trim();
    
    // Loopback (::1) and Unspecified (::)
    if (
      cleanIp === "::1" ||
      cleanIp === "::" ||
      cleanIp === "0:0:0:0:0:0:0:1" ||
      cleanIp === "0:0:0:0:0:0:0:0"
    ) {
      return true;
    }

    // Unique Local (fc00::/7)
    if (cleanIp.startsWith("fc") || cleanIp.startsWith("fd")) return true;

    // Link-local (fe80::/10)
    if (
      cleanIp.startsWith("fe8") ||
      cleanIp.startsWith("fe9") ||
      cleanIp.startsWith("fea") ||
      cleanIp.startsWith("feb")
    ) {
      return true;
    }

    // Multicast (ff00::/8)
    if (cleanIp.startsWith("ff")) return true;

    return false;
  }

  return true; // Block unknown formats
}

/**
 * Validates a public URL and resolves its DNS to ensure it does not point to a private network.
 */
export async function validateUrl(urlStr: string): Promise<{
  isValid: boolean;
  error?: string;
  resolvedIp?: string;
  parsedUrl?: URL;
}> {
  try {
    if (!urlStr) {
      return { isValid: false, error: "URL is empty." };
    }

    const parsed = new URL(urlStr);

    // 1. Enforce protocols
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { isValid: false, error: "Protocol must be http: or https:." };
    }

    // 2. Reject credentials in URL
    if (parsed.username || parsed.password) {
      return { isValid: false, error: "Embedded username or password credentials are not allowed." };
    }

    // 3. Restrict ports to standard web ports
    if (parsed.port && parsed.port !== "80" && parsed.port !== "443" && parsed.port !== "8080") {
      return { isValid: false, error: "Port is blocked for safety. Only standard HTTP(S) ports are allowed." };
    }

    const hostname = parsed.hostname;

    // 4. Reject localhost or local domain names
    if (
      hostname.toLowerCase() === "localhost" ||
      hostname.toLowerCase().endsWith(".local")
    ) {
      return { isValid: false, error: "Local or private domain names are blocked." };
    }

    // 5. If hostname is raw IP, validate it directly
    if (net.isIP(hostname)) {
      if (isPrivateIp(hostname)) {
        return { isValid: false, error: "Private or loopback IP addresses are blocked." };
      }
      return { isValid: true, resolvedIp: hostname, parsedUrl: parsed };
    }

    // 6. Resolve DNS server-side to check against IP spoofing / private IPs
    const dnsPromises = dns.promises;
    const lookup = await dnsPromises.lookup(hostname);
    const ip = lookup.address;

    if (isPrivateIp(ip)) {
      return { isValid: false, error: "Hostname resolves to a private or loopback IP address." };
    }

    return { isValid: true, resolvedIp: ip, parsedUrl: parsed };
  } catch (err: unknown) {
    const error = err as Error;
    return { isValid: false, error: error.message || "Invalid URL structure." };
  }
}
